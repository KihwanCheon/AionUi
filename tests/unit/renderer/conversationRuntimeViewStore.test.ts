import { beforeEach, describe, expect, it } from 'vitest';
import type { TConversationRuntimeSummary } from '@/common/config/storage';
import {
  getConversationRuntimeViewSnapshot,
  hydrateSucceeded,
  localSendAccepted,
  localSendStarted,
  localStopAcknowledged,
  localStopRequested,
  resetConversationRuntimeViewStoreForTest,
  turnCompleted,
  runtimeChanged,
} from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';

const idleRuntime = (): TConversationRuntimeSummary => ({
  state: 'idle',
  can_send_message: true,
  has_task: true,
  task_status: 'finished',
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
});

const runningRuntime = (turn_id: string): TConversationRuntimeSummary => ({
  state: 'running',
  can_send_message: false,
  has_task: true,
  task_status: 'running',
  is_processing: true,
  pending_confirmations: 0,
  turn_id,
});

const cancellingRuntime = (turn_id: string): TConversationRuntimeSummary => ({
  state: 'cancelling',
  can_send_message: true,
  has_task: true,
  task_status: 'running',
  is_processing: false,
  pending_confirmations: 0,
  turn_id,
});

describe('conversationRuntimeViewStore turn id contract', () => {
  beforeEach(() => {
    resetConversationRuntimeViewStoreForTest();
  });

  it('ignores a stale turn.completed for a turn that is no longer active (codex background exec)', () => {
    // codex ends its prompt turn while unified exec keeps the command running;
    // the trailing CLI-initiated turn's completion lands AFTER the user's next
    // turn started and used to clear that new turn's pending gate.
    localSendStarted('conv-1');
    localSendAccepted('conv-1', 'turn-new', runningRuntime('turn-new'), 'msg-1');
    expect(getConversationRuntimeViewSnapshot('conv-1').activeTurnId).toBe('turn-new');

    const logs = turnCompleted('conv-1', 'turn-orphan', idleRuntime());

    const view = getConversationRuntimeViewSnapshot('conv-1');
    expect(view.activeTurnId).toBe('turn-new');
    expect(view.isProcessing).toBe(true);
    expect(view.canSendMessage).toBe(false);
    expect(logs.map((l) => l.event)).toContain('turn_completed_ignored_for_other_turn');
  });

  it('still applies turn.completed for the active turn', () => {
    localSendStarted('conv-1');
    localSendAccepted('conv-1', 'turn-1', runningRuntime('turn-1'), 'msg-1');

    const logs = turnCompleted('conv-1', 'turn-1', idleRuntime());

    const view = getConversationRuntimeViewSnapshot('conv-1');
    expect(view.canSendMessage).toBe(true);
    expect(view.isProcessing).toBe(false);
    expect(logs.map((l) => l.event)).toContain('turn_completed_applied');
  });

  it('keeps idle when turn.completed arrives before local send accepted', () => {
    localSendStarted('conv-1');
    turnCompleted('conv-1', 'turn-1', idleRuntime());
    localSendAccepted('conv-1', 'turn-1', runningRuntime('turn-1'), 'msg-1');

    const view = getConversationRuntimeViewSnapshot('conv-1');
    expect(view.state).toBe('idle');
    expect(view.isProcessing).toBe(false);
    expect(view.canSendMessage).toBe(true);
    expect(view.localSubmitting).toBe(false);
    expect(view.activeTurnId).toBeNull();
  });

  it('keeps idle when a stale running hydrate arrives after turn.completed', () => {
    localSendStarted('conv-1');
    localSendAccepted('conv-1', 'turn-1', runningRuntime('turn-1'), 'msg-1');
    turnCompleted('conv-1', 'turn-1', idleRuntime());
    const logs = hydrateSucceeded('conv-1', runningRuntime('turn-1'));

    const view = getConversationRuntimeViewSnapshot('conv-1');
    expect(view.state).toBe('idle');
    expect(view.isProcessing).toBe(false);
    expect(view.canSendMessage).toBe(true);
    expect(view.activeTurnId).toBeNull();
    expect(logs[0]).toMatchObject({
      event: 'runtime_hydrated',
      data: {
        stale_after_completed: true,
        source: 'hydrate',
      },
    });
  });

  it('keeps idle when a stale stop acknowledgement arrives after turn.completed', () => {
    hydrateSucceeded('conv-1', runningRuntime('turn-1'));
    localStopRequested('conv-1', 'turn-1');
    turnCompleted('conv-1', 'turn-1', idleRuntime());
    const logs = localStopAcknowledged('conv-1', 'turn-1', runningRuntime('turn-1'));

    const view = getConversationRuntimeViewSnapshot('conv-1');
    expect(view.state).toBe('idle');
    expect(view.isProcessing).toBe(false);
    expect(view.canSendMessage).toBe(true);
    expect(view.localStopping).toBe(false);
    expect(view.activeTurnId).toBeNull();
    expect(logs[0]).toMatchObject({
      event: 'local_stop_acknowledged',
      data: {
        stale_after_completed: true,
        source: 'stop_response',
      },
    });
  });

  it('uses send response runtime summary as authoritative active turn', () => {
    localSendStarted('conv-1');
    localSendAccepted('conv-1', 'turn-1', runningRuntime('turn-1'), 'msg-1');

    const view = getConversationRuntimeViewSnapshot('conv-1');
    expect(view.state).toBe('running');
    expect(view.isProcessing).toBe(true);
    expect(view.canSendMessage).toBe(false);
    expect(view.localSubmitting).toBe(false);
    expect(view.activeTurnId).toBe('turn-1');
  });

  it('keeps cancelling runtime gated from new sends', () => {
    hydrateSucceeded('conv-1', cancellingRuntime('turn-cancel'));

    const view = getConversationRuntimeViewSnapshot('conv-1');
    expect(view.state).toBe('cancelling');
    expect(view.isProcessing).toBe(true);
    expect(view.canSendMessage).toBe(false);
    expect(view.activeTurnId).toBe('turn-cancel');
  });

  it('ignores stale stop ack for an older turn', () => {
    hydrateSucceeded('conv-1', runningRuntime('turn-2'));
    localStopRequested('conv-1', 'turn-1');
    localStopAcknowledged('conv-1', 'turn-1', runningRuntime('turn-2'));

    const view = getConversationRuntimeViewSnapshot('conv-1');
    expect(view.activeTurnId).toBe('turn-2');
    expect(view.isProcessing).toBe(true);
    expect(view.localStopping).toBe(false);
  });

  it('uses cancel response runtime summary as authoritative state', () => {
    hydrateSucceeded('conv-1', runningRuntime('turn-1'));
    localStopRequested('conv-1', 'turn-1');
    localStopAcknowledged('conv-1', 'turn-1', runningRuntime('turn-2'));

    const view = getConversationRuntimeViewSnapshot('conv-1');
    expect(view.activeTurnId).toBe('turn-2');
    expect(view.isProcessing).toBe(true);
    expect(view.localStopping).toBe(false);
  });

  const backgroundRuntime = (
    revision: number,
    target: string | null = 'background-1'
  ): TConversationRuntimeSummary => ({
    ...idleRuntime(),
    can_stop: target !== null,
    cancel_turn_id: target,
    runtime_instance_id: 'core-1',
    runtime_revision: revision,
  });

  it('keeps a continuation stoppable while allowing input and without a foreground claim', () => {
    runtimeChanged('conv-1', backgroundRuntime(2));
    expect(getConversationRuntimeViewSnapshot('conv-1')).toMatchObject({
      activeTurnId: null,
      cancelTurnId: 'background-1',
      canStop: true,
      isProcessing: false,
      canSendMessage: true,
    });
    localStopRequested('conv-1', 'background-1');
    expect(getConversationRuntimeViewSnapshot('conv-1').localStopping).toBe(true);
  });

  it('ignores an older HTTP hydrate after a continuation starts through realtime', () => {
    runtimeChanged('conv-1', backgroundRuntime(2));
    hydrateSucceeded('conv-1', backgroundRuntime(1, null));
    expect(getConversationRuntimeViewSnapshot('conv-1')).toMatchObject({ canStop: true, cancelTurnId: 'background-1' });
  });

  it('keeps the continuation target when an older foreground completion arrives afterwards', () => {
    hydrateSucceeded('conv-1', {
      ...runningRuntime('foreground-1'),
      runtime_instance_id: 'core-1',
      runtime_revision: 1,
    });
    runtimeChanged('conv-1', backgroundRuntime(3));
    turnCompleted('conv-1', 'foreground-1', backgroundRuntime(2, null));
    expect(getConversationRuntimeViewSnapshot('conv-1')).toMatchObject({ canStop: true, cancelTurnId: 'background-1' });
  });

  it('keeps a pending send gated while acknowledging a stop on its predecessor', () => {
    runtimeChanged('conv-1', backgroundRuntime(2));
    localStopRequested('conv-1', 'background-1');
    localSendStarted('conv-1');
    localStopAcknowledged('conv-1', 'background-1', backgroundRuntime(3, null));
    expect(getConversationRuntimeViewSnapshot('conv-1')).toMatchObject({
      localSubmitting: true,
      canSendMessage: false,
    });
  });

  it('does not resurrect a completed continuation from a delayed stop response', () => {
    runtimeChanged('conv-1', backgroundRuntime(2));
    localStopRequested('conv-1', 'background-1');
    runtimeChanged('conv-1', backgroundRuntime(4, null));
    localStopAcknowledged('conv-1', 'background-1', { ...backgroundRuntime(3), state: 'cancelling' });
    expect(getConversationRuntimeViewSnapshot('conv-1')).toMatchObject({
      canStop: false,
      cancelTurnId: null,
      localStopping: false,
    });
  });

  it('accepts a restarted Core instance and rejects late snapshots from the retired instance', () => {
    hydrateSucceeded('conv-1', backgroundRuntime(100));
    runtimeChanged('conv-1', { ...backgroundRuntime(1, 'background-new'), runtime_instance_id: 'core-2' });
    hydrateSucceeded('conv-1', backgroundRuntime(101, null));
    expect(getConversationRuntimeViewSnapshot('conv-1').cancelTurnId).toBe('background-new');
  });

  it('keeps a new pending send gated when the preceding continuation completes', () => {
    runtimeChanged('conv-1', backgroundRuntime(2));
    localSendStarted('conv-1');
    runtimeChanged('conv-1', backgroundRuntime(3, null));
    turnCompleted('conv-1', 'background-1', backgroundRuntime(3, null));
    expect(getConversationRuntimeViewSnapshot('conv-1')).toMatchObject({
      localSubmitting: true,
      canSendMessage: false,
    });
    localSendAccepted('conv-1', 'foreground-1', {
      ...runningRuntime('foreground-1'),
      runtime_instance_id: 'core-1',
      runtime_revision: 4,
      cancel_turn_id: 'foreground-1',
      can_stop: true,
    });
    expect(getConversationRuntimeViewSnapshot('conv-1')).toMatchObject({
      localSubmitting: false,
      cancelTurnId: 'foreground-1',
      canStop: true,
    });
  });
});
