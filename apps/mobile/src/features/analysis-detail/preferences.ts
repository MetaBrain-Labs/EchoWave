/** Stores analysis-detail UI preferences for the lifetime of the current app session. */
let hideIrrelevantSegments = false;

export function getHideIrrelevantSegmentsPreference() {
  return hideIrrelevantSegments;
}

export function setHideIrrelevantSegmentsPreference(value: boolean) {
  hideIrrelevantSegments = value;
}
