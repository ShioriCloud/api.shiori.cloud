import { canTransition } from './automation.states';

describe('automation state transitions', () => {
  it('allows subtitle path happy transitions', () => {
    expect(canTransition('SUBTITLE_RECEIVED', 'MATCHED')).toBe(true);
    expect(canTransition('MATCHED', 'ELIGIBLE')).toBe(true);
    expect(canTransition('ELIGIBLE', 'SEARCHING')).toBe(true);
    expect(canTransition('SEARCHING', 'DOWNLOAD_QUEUED')).toBe(true);
    expect(canTransition('DOWNLOAD_QUEUED', 'DOWNLOADING')).toBe(true);
    expect(canTransition('DOWNLOADING', 'DOWNLOADED')).toBe(true);
    expect(canTransition('DOWNLOADED', 'MUXING')).toBe(true);
    expect(canTransition('MUXING', 'VALIDATING')).toBe(true);
    expect(canTransition('VALIDATING', 'READY_FOR_ARCHIVE')).toBe(true);
    expect(canTransition('READY_FOR_ARCHIVE', 'AWAITING_MANUAL_ARCHIVE')).toBe(
      true,
    );
    expect(canTransition('LINKED', 'DRAFT_QUEUED')).toBe(true);
    expect(canTransition('DRAFT_QUEUED', 'AWAITING_APPROVAL')).toBe(true);
    expect(canTransition('AWAITING_APPROVAL', 'PUBLISHED')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('ELIGIBLE', 'PUBLISHED')).toBe(false);
    expect(canTransition('PUBLISHED', 'ELIGIBLE')).toBe(false);
    expect(canTransition('CANCELLED', 'SEARCHING')).toBe(false);
  });

  it('allows same-state no-op', () => {
    expect(canTransition('DOWNLOADING', 'DOWNLOADING')).toBe(true);
  });

  it('allows re-search from awaiting selection', () => {
    expect(canTransition('AWAITING_SELECTION', 'ELIGIBLE')).toBe(true);
    expect(canTransition('AWAITING_SELECTION', 'DOWNLOAD_QUEUED')).toBe(true);
  });
});
