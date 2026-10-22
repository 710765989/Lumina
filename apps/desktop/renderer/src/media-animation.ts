export type AnimatedMediaInput = { kind: string; absolutePath: string; sizeBytes: number; metadata?: Record<string, any> };

/** Share animation detection and metadata wiring across media grids. WebM remains a video. */
export function mediaAnimationProps(item: AnimatedMediaInput) {
  const animated = item.kind !== 'video' && Boolean(item.metadata?.animated || /\.gif$/iu.test(item.absolutePath));
  return {
    animated,
    sizeBytes: item.sizeBytes,
    animationWidth: typeof item.metadata?.width === 'number' ? item.metadata.width : undefined,
    animationHeight: typeof item.metadata?.height === 'number' ? item.metadata.height : undefined,
    animationFrames: typeof item.metadata?.frames === 'number' ? item.metadata.frames : undefined,
  };
}
