/**
 * 素材驱动的跨平台 SVG 加载动画。
 *
 * 由本地 SVG 的原始形状与预处理 SMIL 关键帧构成。
 *
 * Responsibilities:
 * - 绘制两款品牌加载动画的静态矢量形状。
 * - 将受控进度映射到原素材的路径及旋转动画。
 *
 * Notes:
 * - 动画生命周期由共享 LoadingIndicator 管理。
 */
import { Platform } from 'react-native';
import Animated, { useAnimatedProps, type SharedValue } from 'react-native-reanimated';
import Svg, { Ellipse, G, Path, type GProps } from 'react-native-svg';

import { interpolatePathMorph, interpolateRotation } from '../loadingAnimation';
import {
  longPath0,
  longPath1,
  longRotation2,
  longRotation3,
  shortPath0,
  shortPath1,
  shortPath2,
  shortPath3,
  shortPath4,
  shortPath5,
  shortPath6,
  shortPath7,
} from './animationData';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** 绘制灰蓝色多层形变动画，并按素材关键帧更新八条路径。 */
export function ShortLoadingAsset({ progress }: { progress: SharedValue<number> }) {
  const pathProps0 = useAnimatedProps(() => ({
    d: interpolatePathMorph(shortPath0, progress.value),
  }));
  const pathProps1 = useAnimatedProps(() => ({
    d: interpolatePathMorph(shortPath1, progress.value),
  }));
  const pathProps2 = useAnimatedProps(() => ({
    d: interpolatePathMorph(shortPath2, progress.value),
  }));
  const pathProps3 = useAnimatedProps(() => ({
    d: interpolatePathMorph(shortPath3, progress.value),
  }));
  const pathProps4 = useAnimatedProps(() => ({
    d: interpolatePathMorph(shortPath4, progress.value),
  }));
  const pathProps5 = useAnimatedProps(() => ({
    d: interpolatePathMorph(shortPath5, progress.value),
  }));
  const pathProps6 = useAnimatedProps(() => ({
    d: interpolatePathMorph(shortPath6, progress.value),
  }));
  const pathProps7 = useAnimatedProps(() => ({
    d: interpolatePathMorph(shortPath7, progress.value),
  }));
  return (
    <Svg height="100%" viewBox="160 160 760 760" width="100%">
      <G transform="matrix(1,0,0,1,540,541)">
        <G>
          <AnimatedPath
            d="M51.315,-192.923C65.36,-189.504,75.599,-179.95,78.197,-160.253C79.55,-145.218,67.418,-130.719,54.126,-125.044C43.508,-120.783,32.303,-120.462,23.478,-124.739C10.19,-131.156,0.5,-141.75,1.825,-160.679C2.996,-177.401,16.775,-188.002,28.406,-190.994C37.408,-193.398,44.36,-195.217,51.315,-192.923Z"
            fill="#33aafc"
            animatedProps={pathProps0}
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,540,541)">
        <G>
          <AnimatedPath
            d="M-127.081,-35.936C-139.338,-41.475,-148.791,-52.481,-146.804,-68.416C-144.686,-82.32,-132.616,-97.145,-114.427,-95.284C-104.179,-94.549,-96.902,-91.519,-91.432,-89.344C-74.154,-83.912,-68.938,-69.395,-70.458,-56C-73.25,-40.353,-84.035,-32.612,-98.615,-32.489C-105.651,-32.315,-118.715,-32.464,-127.081,-35.936Z"
            fill="#a5c0d3"
            animatedProps={pathProps1}
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,540,541)">
        <G>
          <AnimatedPath
            d="M-105.76,-323.951C-76.514,-331.673,-31.178,-321.09,-13.453,-273.906C-3.003,-247.964,-12.244,-204.384,-47.472,-182.704C-58.988,-177.09,-83.716,-169.782,-94.432,-166.494C-129.467,-154.29,-171.391,-171.68,-184.521,-200.443C-197.074,-228.496,-198.25,-258.672,-168.616,-290.755C-153.775,-302.495,-132.677,-316.869,-105.76,-323.951Z"
            fill="#bdc5ca"
            animatedProps={pathProps2}
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,540,541)">
        <G>
          <AnimatedPath
            d="M25.908,3.066C13.959,3.123,-1.118,-3.615,-4.416,-19.959C-6.461,-32.186,-2.588,-47.319,17.126,-52.787C22.175,-54.126,32.808,-54.718,37.873,-54.312C54.514,-52.913,66.646,-41.899,66.836,-27.286C67.792,-14.586,58.058,0.169,43.207,2.536C38.368,3.271,28.971,3.077,25.908,3.066Z"
            fill="#9ec5df"
            animatedProps={pathProps3}
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,537.891,540)">
        <G>
          <AnimatedPath
            d="M-10.35,133.345C-18.385,131.693,-29.523,125.355,-31.513,110.946C-33.088,97.12,-26.147,87.066,-14.779,81.749C-6.869,78.512,0.603,78.044,12.794,79.198C28.963,81.228,37.725,93.039,37.644,108.085C36.842,122.128,27.463,133.074,14.403,134.854C4.728,135.517,-2.39,134.897,-10.35,133.345Z"
            fill="#568bb3"
            animatedProps={pathProps4}
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,540,540)">
        <G>
          <AnimatedPath
            d="M136.067,-133.323C179.071,-127.369,246.81,-92.811,244.866,-3.057C238.981,84.2,165.334,113.061,118.961,116.22C103.966,117.459,81.093,117.608,63.594,116.591C15.133,111.04,-45.679,71.084,-50.711,-11.803C-51.297,-75.981,-2.294,-131.482,65.625,-136.995C79.526,-139.467,110.365,-137.591,136.067,-133.323Z"
            fill="#748ea0"
            animatedProps={pathProps5}
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,540,540)">
        <G>
          <AnimatedPath
            d="M287.63,167.153C281.75,194.827,258.991,226,213.859,222.929C174.542,220.421,150.323,187.576,147.988,157.88C147.235,149.194,148.717,135.661,151.584,125.241C162.513,95.36,182.607,73.797,215.442,75.597C248.309,78.272,271.3,93.268,283.91,120.575C289.978,135.799,290.65,152.104,287.63,167.153Z"
            fill="#33aafc"
            animatedProps={pathProps6}
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,540,540)">
        <G>
          <AnimatedPath
            d="M138.793,-103.069C151.427,-121.953,173.054,-124.692,191.892,-113.4C217.902,-98.724,215.001,-68.984,208.172,-57.279C204.506,-51.917,199.144,-49.096,192.521,-45.504C176.05,-32.533,153.418,-33.771,140.767,-42.836C131.066,-49.787,113.68,-71.413,128.657,-93.479C133.131,-97.754,133.794,-96.961,138.793,-103.069Z"
            fill="#497797"
            animatedProps={pathProps7}
          />
        </G>
      </G>
    </Svg>
  );
}

/** 绘制猫咪身体形变和耳朵摆动，保留素材的颜色、层级与变换。 */
export function LongLoadingAsset({ progress }: { progress: SharedValue<number> }) {
  const isWeb = Platform.OS === 'web';
  const pathProps0 = useAnimatedProps(() => ({
    d: interpolatePathMorph(longPath0, progress.value),
  }));
  const pathProps1 = useAnimatedProps(() => ({
    d: interpolatePathMorph(longPath1, progress.value),
  }));
  const rotationProps2 = useAnimatedProps<GProps & { matrix: number[] }>(() => {
    const matrix = interpolateRotation(
      longRotation2.frames,
      longRotation2.keyTimes,
      longRotation2.keySplines,
      progress.value,
    );
    // 原生 SVG 接收六元素 matrix；Web 使用 SVG transform 属性更新 DOM。
    return isWeb ? { transform: `matrix(${matrix.join(',')})` } : { matrix };
  });
  const rotationProps3 = useAnimatedProps<GProps & { matrix: number[] }>(() => {
    const matrix = interpolateRotation(
      longRotation3.frames,
      longRotation3.keyTimes,
      longRotation3.keySplines,
      progress.value,
    );
    return isWeb ? { transform: `matrix(${matrix.join(',')})` } : { matrix };
  });
  return (
    <Svg height="100%" viewBox="0 0 280 200" width="100%">
      <G transform="matrix(1.062,0,0,1.289,198.251,153.22)">
        <G transform="matrix(1,0,0,1,-52.446,2.907)">
          <Ellipse ry="4.088" rx="37.947" cy="0" cx="0" fill="#9999c2" />
        </G>
      </G>
      <G transform="matrix(0.689,0,0,0.344,166.547,152.16)">
        <G>
          <AnimatedPath
            d="M7.638,18.504C7.638,18.504,19.787,29.782,27.323,11.811C32.441,-0.394,12.756,-25.196,23.78,-35.039C33.542,-43.755,56.85,-35.04,46.614,-14.961"
            strokeLinecap="round"
            strokeWidth="15"
            stroke="#9999c2"
            animatedProps={pathProps0}
          />
        </G>
      </G>
      <G transform="matrix(0.861,0,0,0.812,164.778,130.315)">
        <G>
          <AnimatedPath
            d="M7.638,18.504C7.638,18.504,19.787,29.782,27.323,11.811C32.441,-0.394,12.756,-25.196,23.78,-35.039C33.542,-43.755,56.85,-35.04,46.614,-14.961"
            strokeLinecap="round"
            strokeWidth="13"
            stroke="#333a4e"
            animatedProps={pathProps1}
          />
        </G>
      </G>
      <G>
        <G transform="translate(156.589,69.788)">
          <AnimatedG transform="rotate(0)" animatedProps={rotationProps2}>
            <G transform="scale(1,1) translate(-7.856,-17.275)">
              <G transform="matrix(1,0,0,1,7.856,17.275)">
                <Path
                  fill="#212432"
                  d="M6.19,-12.905C6,-15.952,2.151,-17.025,0.681,-14.349C0.681,-14.349,-7.607,-4.578,-7.607,-4.578C-7.607,-4.578,5.423,17.025,5.423,17.025C5.423,17.025,7.607,9.782,6.19,-12.905Z"
                />
              </G>
            </G>
          </AnimatedG>
        </G>
      </G>
      <G>
        <G transform="translate(132.432,63.714)">
          <AnimatedG transform="rotate(0)" animatedProps={rotationProps3}>
            <G transform="scale(1,1) translate(-7.207,-11.228)">
              <G transform="matrix(1,0,0,1,7.207,11.228)">
                <Path
                  fill="#212432"
                  d="M6.957,-2.142C6.957,-2.142,1.453,-8.288,1.453,-8.288C0.011,-10.978,-4.07,-9.953,-4.07,-6.9C-4.07,-6.9,-6.957,10.978,-6.957,10.978C-6.957,10.978,6.957,-2.142,6.957,-2.142Z"
                />
              </G>
            </G>
          </AnimatedG>
        </G>
      </G>
      <G transform="matrix(1,0,0,1,111.138,85.053)">
        <G transform="matrix(1,0,0,1,34.667,38.551)">
          <Path
            fill="#333a4e"
            d="M30.133,34.363C32.884,27.219,34.418,18.992,34.339,10.247C34.096,-16.582,18.458,-38.301,-0.396,-38.027C-19.218,-37.753,-34.417,-15.957,-34.417,10.891C-34.417,19.411,-32.886,27.422,-30.195,34.398C-29.26,36.821,-27.453,38.301,-25.51,38.301C-25.51,38.301,25.434,38.301,25.434,38.301C27.387,38.301,29.196,36.8,30.133,34.363Z"
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,117.347,59.809)">
        <G transform="matrix(1,0,0,1,22.961,52.658)">
          <Path
            fill="#333a4e"
            d="M0.001,49.471C0.001,49.471,0.001,49.471,0.001,49.471C-12.49,49.471,-22.711,39.251,-22.711,26.76C-22.711,26.76,-22.711,-29.697,-22.711,-29.697C-22.711,-42.188,-12.49,-52.408,0.001,-52.408C12.492,-52.408,22.711,-42.188,22.711,-29.697C22.711,-29.697,22.711,34.865,22.711,34.865C22.711,45.659,12.952,37.892,12.952,42.408C12.952,52.408,3.958,48.84,0.001,49.471Z"
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,119.126,153.507)">
        <G transform="matrix(1,0,0,1,6.144,4.34)">
          <Path
            fill="#333a4e"
            d="M3.748,4.027C5.058,3.187,5.894,1.916,5.894,0.492C5.894,-2.038,3.255,-4.09,0,-4.09C-3.255,-4.09,-5.894,-2.038,-5.894,0.492C-5.894,1.757,-4.979,3.261,-3.912,4.09C-3.912,4.09,3.748,4.027,3.748,4.027Z"
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,149.534,142.169)">
        <G transform="matrix(1,0,0,1,4.269,9.999)">
          <Path
            fill="#bac1d8"
            d="M-3.946,9.749C-3.946,9.749,-0.511,7.996,-2.119,4.342C-2.661,3.017,-4.019,2.515,-4.019,2.515C-4.019,2.515,-1.48,-9.227,-1.48,-9.227C-1.376,-9.707,-0.707,-9.749,-0.553,-9.282C0.246,-6.868,1.858,-2.42,3.824,0.746C4.019,1.06,3.822,1.46,3.452,1.477C2.316,1.529,0.408,1.89,0,3.685C-0.408,5.478,0.132,9.156,2.032,9.741C2.032,9.741,-3.946,9.749,-3.946,9.749Z"
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,122.367,80.9)">
        <G transform="matrix(1,0,0,1,11.608,40.651)">
          <Path
            fill="#d9deed"
            d="M10.421,-10.549C11.062,-12.101,11.357,-13.777,11.113,-15.439C10.22,-21.536,7.337,-35.722,-0.361,-37.775C-10.209,-40.401,-11.358,-23.988,-9.717,-12.991C-8.076,-1.994,-5.284,-7.738,-4.135,10.808C-2.986,29.355,-2.379,36.266,-3.189,38.32C-3.666,39.53,-4.956,40.352,-4.956,40.352C-4.956,40.352,8.84,40.401,8.84,40.401C8.84,40.401,6.204,38.383,6.04,33.459C5.886,28.843,5.589,1.145,10.421,-10.549Z"
          />
        </G>
      </G>
      <G transform="matrix(1,0,0,1,133.364,67.34)">
        <G transform="matrix(1,0,0,1,4.076,1.879)">
          <Path
            fill="#020100"
            d="M1.084,-0.346C-1.078,-1.629,-3.826,-0.507,-2.139,0.561C-0.451,1.629,3.826,1.28,1.084,-0.346Z"
          />
        </G>
      </G>
    </Svg>
  );
}
