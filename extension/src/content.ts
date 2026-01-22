// file: extension/src/content.ts

export type CapturedMessage = {
  author: string;
  text: string;
  timestamp?: string;
};

export function captureRecentMessages(): CapturedMessage[] {
  return [];
}
