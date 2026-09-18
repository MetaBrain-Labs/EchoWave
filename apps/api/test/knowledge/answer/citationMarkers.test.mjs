/**
 * 引用标记规范化回归。
 *
 * 验证答案正文中的 [n] 标记始终与服务端引用清单一一对应，
 * 覆盖模型写出多余标记、乱序标记以及缺少标记的三种情况。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveCitationMarkers } from '../../../dist/knowledge/answer/citationMarkers.js';

const ids = ['a', 'b', 'c'];

describe('resolveCitationMarkers', () => {
  it('drops markers beyond the verified citation list', () => {
    const resolved = resolveCitationMarkers(
      '知识库包含九类核心内容。[1][2][3][4][5][6][7][8][9]',
      ids,
    );

    assert.equal(resolved.answer, '知识库包含九类核心内容。[1][2][3]');
    assert.deepEqual(resolved.citationIds, ids);
    assert.equal(resolved.droppedMarkerCount, 6);
  });

  it('renumbers markers in first-mention order and reorders citations to match', () => {
    const resolved = resolveCitationMarkers('先看第三份依据。[3]再看第一份。[1][3]', ids);

    assert.equal(resolved.answer, '先看第三份依据。[1]再看第一份。[2][1]');
    assert.deepEqual(resolved.citationIds, ['c', 'a', 'b']);
    assert.equal(resolved.droppedMarkerCount, 0);
  });

  it('keeps unreferenced citations in the complete source list', () => {
    const resolved = resolveCitationMarkers('只有一条依据。[2]', ids);

    assert.equal(resolved.answer, '只有一条依据。[1]');
    assert.deepEqual(resolved.citationIds, ['b', 'a', 'c']);
  });

  it('keeps the original citation order when the answer has no markers', () => {
    const resolved = resolveCitationMarkers('知识库中有三条依据。', ids);

    assert.equal(resolved.answer, '知识库中有三条依据。');
    assert.deepEqual(resolved.citationIds, ids);
    assert.equal(resolved.droppedMarkerCount, 0);
  });

  it('removes every marker when the answer has no verified citation', () => {
    const resolved = resolveCitationMarkers('未经确认的答案。[1][9]', []);

    assert.equal(resolved.answer, '未经确认的答案。');
    assert.deepEqual(resolved.citationIds, []);
    assert.equal(resolved.droppedMarkerCount, 2);
  });

  it('is idempotent for an already consistent answer', () => {
    const first = resolveCitationMarkers('第一条依据。[1]第二条依据。[2]', ids);
    const second = resolveCitationMarkers(first.answer, first.citationIds);

    assert.equal(second.answer, first.answer);
    assert.deepEqual(second.citationIds, first.citationIds);
    assert.equal(second.droppedMarkerCount, 0);
  });
});
