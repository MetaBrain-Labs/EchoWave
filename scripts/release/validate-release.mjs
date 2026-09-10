/**
 * GitHub Release 前置校验入口。
 *
 * 校验稳定 Tag、main 祖先关系、全部版本来源与上一稳定版本回退窗口，并向工作流输出
 * 后续构建需要的标准化版本信息。
 */
import path from 'node:path';

import {
  appendGitHubOutput,
  assertCommitOnMain,
  findPreviousStableTag,
  validateReleaseConfiguration,
} from './release-lib.mjs';

const tag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
const commit = process.env.RELEASE_COMMIT ?? process.env.GITHUB_SHA;
const mainRef = process.env.RELEASE_MAIN_REF ?? 'origin/main';
if (!tag || !commit) throw new Error('RELEASE_TAG and RELEASE_COMMIT are required.');

const rootDirectory = path.resolve(import.meta.dirname, '../..');
assertCommitOnMain(rootDirectory, commit, mainRef);
const previousStableTag = findPreviousStableTag(rootDirectory, tag, mainRef);
const result = validateReleaseConfiguration(rootDirectory, tag, previousStableTag);
appendGitHubOutput(process.env.GITHUB_OUTPUT, {
  version: result.version,
  previous_tag: previousStableTag,
  minimum_direct_rollback_version: result.minimumDirectRollbackVersion,
});
console.log(JSON.stringify(result, null, 2));
