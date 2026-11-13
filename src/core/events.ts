// A tiny typed publish/subscribe bus. Systems talk through events instead of reaching into each other.
// Usage: const bus = new EventBus<{ 'thing:happened': { amount: number } }>();

export type Unsubscribe = () => void;
type Handler = (payload: unknown) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler>>();

  on<K extends keyof Events>(name: K, handler: (payload: Events[K]) => void): Unsubscribe {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    const stored = handler as Handler;
    set.add(stored);
    return () => set.delete(stored);
  }

  emit<K extends keyof Events>(name: K, payload: Events[K]): void {
    this.handlers.get(name)?.forEach((handler) => handler(payload));
  }
}
