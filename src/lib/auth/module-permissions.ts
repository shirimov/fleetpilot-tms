import type { CompanyMembershipRole } from '@prisma/client';

export type FleetPilotModule =
  | 'tasks'
  | 'profile'
  | 'operations'
  | 'fleet'
  | 'finance'
  | 'hr'
  | 'administration';

const ALL_MODULES: readonly FleetPilotModule[] = [
  'tasks',
  'profile',
  'operations',
  'fleet',
  'finance',
  'hr',
  'administration',
];

const ROLE_MODULES: Record<CompanyMembershipRole, ReadonlySet<FleetPilotModule>> = {
  MEMBER: new Set(['tasks', 'profile']),
  ADMIN: new Set(ALL_MODULES),
  OWNER: new Set(ALL_MODULES),
};

const PAGE_MODULES: ReadonlyArray<[prefix: string, module: FleetPilotModule]> = [
  ['/tasks', 'tasks'],
  ['/profile', 'profile'],
  ['/settings', 'profile'],
  ['/administration', 'administration'],
  ['/companies', 'administration'],
  ['/inbox', 'administration'],
  ['/hr', 'hr'],
  ['/finance', 'finance'],
  ['/accounting', 'finance'],
  ['/settlements', 'finance'],
  ['/loads', 'operations'],
  ['/dispatch', 'operations'],
  ['/drivers', 'fleet'],
  ['/trucks', 'fleet'],
  ['/inspections', 'fleet'],
];

const API_MODULES: ReadonlyArray<[prefix: string, module: FleetPilotModule]> = [
  ['/api/tasks', 'tasks'],
  ['/api/auth/company', 'profile'],
  ['/api/workforce', 'profile'],
  ['/api/company/team', 'administration'],
  ['/api/companies', 'administration'],
  ['/api/inbox', 'administration'],
  ['/api/employees', 'hr'],
  ['/api/escrow', 'hr'],
  ['/api/tmfund', 'hr'],
  ['/api/plaid', 'finance'],
  ['/api/settlements', 'finance'],
  ['/api/reserve', 'finance'],
  ['/api/finance', 'finance'],
  ['/api/dashboard', 'operations'],
  ['/api/dispatch', 'operations'],
  ['/api/loads', 'operations'],
  ['/api/customers', 'operations'],
  ['/api/qm-stats', 'operations'],
  ['/api/trucks', 'fleet'],
  ['/api/trailers', 'fleet'],
  ['/api/drivers', 'fleet'],
  ['/api/inspections', 'fleet'],
  ['/api/uploads', 'fleet'],
];

const PUBLIC_API_PREFIXES = [
  '/api/health',
  '/api/integrations/telegram/webhook',
  '/api/integrations/plaid/webhook',
  '/api/telegram/webhook',
] as const;

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function roleCanAccessModule(
  role: CompanyMembershipRole,
  module: FleetPilotModule,
) {
  return ROLE_MODULES[role].has(module);
}

export function moduleForPath(pathname: string): FleetPilotModule | null {
  if (pathname === '/login' || pathname === '/access-denied') return null;
  if (
    pathname.startsWith('/api/auth/')
    && !matchesPrefix(pathname, '/api/auth/company')
  ) {
    return null;
  }
  if (PUBLIC_API_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return null;
  }
  if (pathname.startsWith('/api/')) {
    return API_MODULES.find(([prefix]) => matchesPrefix(pathname, prefix))?.[1]
      ?? 'administration';
  }
  if (pathname === '/') return 'operations';
  return PAGE_MODULES.find(([prefix]) => matchesPrefix(pathname, prefix))?.[1]
    ?? 'administration';
}

export function landingPageForRole(role: CompanyMembershipRole) {
  return role === 'MEMBER' ? '/tasks' : '/';
}

export function roleCanAccessPath(
  role: CompanyMembershipRole,
  pathname: string,
) {
  const accessModule = moduleForPath(pathname);
  return accessModule === null || roleCanAccessModule(role, accessModule);
}
