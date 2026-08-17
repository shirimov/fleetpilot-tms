export type NavigationItem = {
  href: string;
  label: string;
  icon: NavigationIconName;
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
      { href: '/', label: 'Dashboard', icon: 'dashboard' },
      { href: '/loads?view=dispatch', label: 'Dispatch Board', icon: 'dispatch' },
      { href: '/loads?view=loads', label: 'Loads', icon: 'loads' },
      { href: '/loads?view=customers', label: 'Customers', icon: 'customers' },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { href: '/trucks', label: 'Trucks', icon: 'trucks' },
      { href: '/loads?view=trailers', label: 'Trailers', icon: 'trailers' },
      { href: '/drivers', label: 'Drivers', icon: 'drivers' },
      { href: '/inspections', label: 'Inspections', icon: 'inspections' },
    ],
  },
  {
    label: 'Work Management',
    items: [{ href: '/tasks', label: 'Task Manager', icon: 'tasks' }],
  },
  {
    label: 'Finance',
    items: [
      { href: '/settlements', label: 'Settlements', icon: 'settlements' },
      { href: '/finance', label: 'Finance', icon: 'finance' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/companies', label: 'Companies', icon: 'companies' },
      { href: '/administration', label: 'Team', icon: 'team' },
      { href: '/hr/employees', label: 'HR', icon: 'hr' },
      { href: '/inbox', label: 'Inbox', icon: 'inbox', unavailable: true },
    ],
  },
];

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
