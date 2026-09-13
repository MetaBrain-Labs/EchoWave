"""真实录像的亚像素摄像机合成。

Node 负责时间轴和插值，FFmpeg 负责解码与编码。Pillow 只做一次浮点仿射采样、
外部遮罩和真实点击位置提示，不重绘、锐化或生成产品内容。
"""
import json
import math
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw

SIZE = (1920, 1080)


def ease(t):
    t = max(0, min(1, t))
    return t * t * (3 - 2 * t)


def layer(frame, rect, pose):
    x, y, w, h = rect
    scale, cx, cy, ax, ay = pose
    source = frame.crop((x, y, x + w, y + h)).convert('RGBA')
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=16, fill=255)
    source.putalpha(mask)
    # 逆变换直接读取源像素：没有整数 crop 坐标或多级 zoompan。
    matrix = (1 / scale, 0, cx - ax / scale - x, 0, 1 / scale, cy - ay / scale - y)
    return source.transform(SIZE, Image.Transform.AFFINE, matrix, Image.Resampling.BICUBIC)


def main():
    config = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    shot = config['shot']
    ff = config['ffmpeg']
    frames = shot['frames']
    # 先按源时间戳展开 VFR 的持帧，再裁切；否则低更新率的末段会被误当成短片。
    norm = f"fps=30:start_time=0,trim=duration={shot['out']-shot['in']},setpts=(PTS-STARTPTS)/{shot['speed']},fps=30:start_time=0,tpad=stop_mode=clone:stop_duration=0.1"
    decoder = subprocess.Popen([ff, '-v', 'error', '-ss', str(shot['in']), '-i', config['source'],
        '-vf', norm, '-frames:v', str(frames), '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
        stdout=subprocess.PIPE, stderr=sys.stderr)
    ass = config['ass'].replace('\\', '/').replace(':', '\\:')
    fonts = config['fonts'].replace('\\', '/').replace(':', '\\:')
    encoder = subprocess.Popen([ff, '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
        '-s', '1920x1080', '-r', '30', '-i', 'pipe:0', '-vf', f"ass='{ass}':fontsdir='{fonts}'",
        '-an', '-frames:v', str(frames), '-c:v', 'libx264', '-preset', 'fast', '-crf', '14',
        '-threads', '4', '-pix_fmt', 'yuv420p', config['target']], stdin=subprocess.PIPE, stderr=sys.stderr)
    background = Image.open(config['background']).convert('RGBA')
    logo = Image.open(config['logo']).convert('RGBA')
    byte_count = 1080 * 2400 * 3
    previous = None
    try:
        for i, pose in enumerate(config['poses']):
            data = decoder.stdout.read(byte_count)
            if len(data) != byte_count:
                # fps 在最后边界可能少一帧；只允许最后一帧的确定性尾帧延续。
                if i != frames - 1 or previous is None:
                    raise RuntimeError(f"源片帧数不足：{shot['id']} {i}/{frames}")
                frame = previous
            else:
                frame = Image.frombytes('RGB', (1080, 2400), data)
                previous = frame
            t = i / 30
            global_time = shot['startFrame'] / 30 + t
            bx = 80 + 35 * math.sin(global_time * .24)
            by = 60 + 22 * math.cos(global_time * .2)
            canvas = background.transform(SIZE, Image.Transform.AFFINE, (1, 0, bx, 0, 1, by), Image.Resampling.BICUBIC)
            canvas = Image.alpha_composite(canvas, layer(frame, shot['bounds'], pose))
            floating = shot.get('floating')
            if floating and t >= floating['start']:
                u = ease((t - floating['start']) / (floating['end'] - floating['start']))
                rect = floating['rect']
                x, y, w, h = rect
                scale, cx, cy, ax, ay = pose
                sx, sy = ax + (x + w/2 - cx)*scale, ay + (y + h/2 - cy)*scale
                target = floating['center']
                lifted = [scale + (floating['scale']-scale)*u, x+w/2, y+h/2,
                    sx+(target[0]-sx)*u, sy+(target[1]-sy)*u]
                canvas = Image.alpha_composite(canvas, Image.new('RGBA', SIZE, (3, 9, 24, round(210*u))))
                canvas = Image.alpha_composite(canvas, layer(frame, rect, lifted))
            focus = shot.get('focus')
            if focus and focus['start'] <= t <= focus['end']:
                u = min(ease((t-focus['start'])/.3), ease((focus['end']-t)/.3))
                shade = Image.new('RGBA', SIZE, (2, 8, 24, round(95*u)))
                x,y,w,h = focus['rect']
                s,cx,cy,ax,ay = pose
                box = (ax+(x-cx)*s, ay+(y-cy)*s, ax+(x+w-cx)*s, ay+(y+h-cy)*s)
                ImageDraw.Draw(shade).rectangle(box, fill=(0,0,0,0), outline=(85,190,177,round(180*u)), width=3)
                canvas = Image.alpha_composite(canvas, shade)
            for start,x,y in shot.get('pulses', []):
                p = (t-start)/.32
                if 0 <= p <= 1:
                    s,cx,cy,ax,ay=pose
                    px,py=ax+(x-cx)*s,ay+(y-cy)*s
                    r=10+18*p
                    overlay=Image.new('RGBA',SIZE)
                    ImageDraw.Draw(overlay).ellipse((px-r,py-r,px+r,py+r),outline=(50,164,143,round(170*(1-p))),width=3)
                    canvas=Image.alpha_composite(canvas,overlay)
            if shot.get('titlePlate'):
                start=shot.get('titleFrom',0)
                end=shot.get('titleUntil',shot['seconds'])
                if start <= t <= end:
                    u=min(ease((t-start)/.2),ease((end-t)/.2))
                    plate=Image.new('RGBA',SIZE)
                    ImageDraw.Draw(plate).rectangle((0,0,1920,290),fill=(5,12,29,round(245*u)))
                    canvas=Image.alpha_composite(canvas,plate)
            if shot.get('brand'):
                size=round(200+24*ease(t/1.2))
                mark=logo.resize((size,size),Image.Resampling.LANCZOS)
                canvas.alpha_composite(mark,(round(960-size/2),110))
            encoder.stdin.write(canvas.convert('RGB').tobytes())
    finally:
        decoder.stdout.close()
        encoder.stdin.close()
        dec_status=decoder.wait()
        enc_status=encoder.wait()
    if dec_status or enc_status:
        raise RuntimeError(f"媒体进程失败：decode={dec_status}, encode={enc_status}")


if __name__ == '__main__':
    main()
