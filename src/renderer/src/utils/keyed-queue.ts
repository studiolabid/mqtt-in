/**
 * Serializes async tasks per key (pure, no Vue): tasks with the same key run one after the
 * other, in call order; different keys run concurrently. A failing task does not block the
 * next one.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>()

  /** Runs `task` after every task queued earlier for `key`; resolves / rejects like `task`. */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.then(task)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return result
  }

  /** Number of keys with queued or running tasks. */
  get size(): number {
    return this.tails.size
  }
}
