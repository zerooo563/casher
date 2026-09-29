import { PGlite } from '@electric-sql/pglite'

let dbInstance: PGlite | null = null

export async function getLocalDb(): Promise<PGlite> {
  if (!dbInstance) {
    dbInstance = new PGlite('idb://casher_local_db')
    await dbInstance.waitReady
  }
  return dbInstance
}
