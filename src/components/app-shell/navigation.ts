import type { CompanyMembershipRole } from '@prisma/client';
import {
  roleCanAccessModule,
  type FleetPilotModule,
} from '@/lib/auth/module-permissions';

export type NavigationItem = {
  href: string;
  label: string;
  icon: NavigationIconName;
  module: FleetPilotModule;
  unavailable?: boolean;
};

export type NavigationSection = {
  label: string;
  items: NavigationItem[];
};

export type NavigationIconName =
  | 'dashboard'
  | 'dispatch'
  | 'loads'
  | 'customers'
  | 'trucks'
  | 'trailers'
  | 'drivers'
  | 'inspections'
  | 'tasks'
  | 'profile'
  | 'settlements'
  | 'finance'
  | 'companies'
  | 'team'
  | 'hr'
  | 'inbox';

export const alphaNavigation: NavigationSection[] = [
  {
    label: 'Operations',
    items: [
      { href: '/', label: 'Dashboard', icon: 'dashboard', module: 'operations' },
      { href: '/loads?view=dispatch', label: 'Dispatch Board', icon: 'dispatch', module: 'operations' },
      { href: '/loads?view=loads', label: 'Loads', icon: 'loads', module: 'operations' },
      { href: '/loads?view=customers', label: 'Customers', icon: 'customers', module: 'operations' },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { href: '/trucks', label: 'Trucks', icon: 'trucks', module: 'fleet' },
      { href: '/loads?view=trailers', label: 'Trailers', icon: 'trailers', module: 'fleet' },
      { href: '/drivers', label: 'Drivers', icon: 'drivers', module: 'fleet' },
      { href: '/inspections', label: 'Inspections', icon: 'inspections', module: 'fleet' },
    ],
  },
  {
    label: 'Work Management',
    items: [
      { href: '/tasks', label: 'Task Manager', icon: 'tasks', module: 'tasks' },
      { href: '/profile', label: 'My Profile', icon: 'profile', module: 'profile' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/accounting', label: 'Accounting', icon: 'finance', module: 'finance' },
      { href: '/accounting/payroll', label: 'Payroll Preview', icon: 'settlements', module: 'finance' },
      { href: '/settlements', label: 'Settlements', icon: 'settlements', module: 'finance' },
      { href: '/finance', label: 'Finance', icon: 'finance', module: 'finance' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/companies', label: 'Companies', icon: 'companies', module: 'administration' },
      { href: '/administration', label: 'Team', icon: 'team', module: 'administration' },
      { href: '/administration/integrations/quickmanage', label: 'Integrations', icon: 'companies', module: 'administration' },
      { href: '/hr/employees', label: 'HR', icon: 'hr', module: 'hr' },
      { href: '/inbox', label: 'Inbox', icon: 'inbox', module: 'administration', unavailable: true },
    ],
  },
];

export function navigationForRole(role: CompanyMembershipRole | undefined) {
  if (!role) return [];
  return alphaNavigation
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => roleCanAccessModule(role, item.module)),
    }))
    .filter((section) => section.items.length > 0);
}

export function navigationItemIsActive(
  itemHref: string,
  pathname: string,
  query: string,
) {
  const [itemPath, itemQuery = ''] = itemHref.split('?');
  if (itemPath === '/') return pathname === '/';
  if (pathname !== itemPath && !pathname.startsWith(`${itemPath}/`)) return false;
  if (!itemQuery) return true;
  const expectedView = new URLSearchParams(itemQuery).get('view');
  const currentView = new URLSearchParams(query).get('view') ?? 'dispatch';
  if (expectedView === 'loads') return currentView === 'loads';
  return expectedView === currentView;
}
