export interface ModuleManifest {
  availability?: 'coming-soon' | 'preview' | 'available';
  id: string;
  version: `${number}.${number}.${number}`;
  title: string;
  description: string;
  category: 'Operations' | 'Commercial' | 'Administration';
  color: 'mint' | 'blue' | 'peach' | 'yellow';
  icon?: `mdi-${string}`;
  permissions: readonly string[];
  publishes: readonly string[];
  subscribes: readonly string[];
}
export interface RecordReference {
  moduleId: string;
  entityType: string;
  entityId: string;
}
export interface BaseRecord {
  id: string;
  hotelId: string;
  departmentId: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  references: RecordReference[];
}
export interface ModuleEvent<T = unknown> {
  id: string;
  type: `${string}.${string}.v${number}`;
  source: string;
  hotelId: string;
  actorId: string;
  occurredAt: string;
  correlationId: string;
  payload: T;
}
export function defineModule(manifest: ModuleManifest): ModuleManifest {
  if (!/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id)) throw Error('Module IDs must use kebab-case.');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw Error('Module versions must use semver.');
  if (!manifest.title.trim() || !manifest.description.trim())
    throw Error('Module titles and descriptions are required.');
  if (
    !manifest.permissions.length ||
    manifest.permissions.some(
      (permission) => !new RegExp('^' + manifest.id + ':[a-z][a-z-]*$').test(permission),
    )
  )
    throw Error('Permissions must use the module namespace.');
  if (new Set(manifest.permissions).size !== manifest.permissions.length)
    throw Error('Duplicate module permission.');
  for (const event of [...manifest.publishes, ...manifest.subscribes]) {
    if (!/^[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.v[1-9]\d*$/.test(event))
      throw Error('Events must use module.action.vN.');
  }
  if (manifest.publishes.some((event) => !event.startsWith(manifest.id + '.')))
    throw Error('Published events must use the module namespace.');
  if (manifest.icon && !manifest.icon.startsWith('mdi-')) throw Error('Module icons must use MDI.');
  return Object.freeze({
    ...manifest,
    availability: manifest.availability ?? 'coming-soon',
    permissions: Object.freeze([...manifest.permissions]),
    publishes: Object.freeze([...manifest.publishes]),
    subscribes: Object.freeze([...manifest.subscribes]),
  });
}
export function validateModules(manifests: readonly ModuleManifest[]): void {
  const ids = new Set<string>();
  for (const manifest of manifests) {
    defineModule(manifest);
    if (ids.has(manifest.id)) throw Error('Duplicate module ID: ' + manifest.id);
    ids.add(manifest.id);
  }
  const published = new Set(manifests.flatMap((manifest) => [...manifest.publishes]));
  for (const manifest of manifests)
    for (const event of manifest.subscribes) {
      if (!published.has(event)) throw Error('No registered publisher for ' + event);
    }
}

export function isModuleEnabled(module: ModuleManifest): boolean {
  return module.availability === 'preview' || module.availability === 'available';
}
