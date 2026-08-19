/**
 * Test-only entry point.
 *
 * Exported as a separate subpath so the harness -- which creates login roles
 * and seeds data -- can never be imported from application code by autocomplete
 * accident.
 */
export { withoutTenantScope } from './client.js'
export * from './__tests__/harness.js'
