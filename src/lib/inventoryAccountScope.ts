let activeAccountScope = 'anonymous'

export function setInventoryAccountScope(userId: string | null, role: string | null): void {
  if (!userId) {
    activeAccountScope = 'anonymous'
    return
  }
  activeAccountScope = role === 'owner'
    ? 'owner'
    : `user_${userId.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

export function getInventoryAccountScope(): string {
  return activeAccountScope
}

export function getInventoryDatabaseName(accountScope: string): string {
  return accountScope === 'owner'
    ? 'idb://casher_local_v1'
    : `idb://casher_local_v1_${accountScope}`
}
