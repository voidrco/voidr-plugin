const snapshots = new WeakMap()

export function projectContextHint(events) {
  if (events == null) return undefined
  const cached = snapshots.get(events)
  if (cached) return cached.event?.data
  let cacheable = Object.isFrozen(events)
  let found
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (cacheable) {
      const entry = Object.getOwnPropertyDescriptor(events, index)
      const type = Object.getOwnPropertyDescriptor(event, 'type')
      cacheable = Boolean(entry && 'value' in entry && type && 'value' in type && Object.isFrozen(event))
    }
    if (event.type === 'voidr/project-context-hint') {
      found = event
      break
    }
  }
  if (cacheable) snapshots.set(events, { event: found })
  return found?.data
}
