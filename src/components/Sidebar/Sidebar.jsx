import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { getStoredUser } from '../../services/api.js';
import { canAccessPermission, getDefaultRoute } from '../../utils/permissions.js';
import { getVisibleNavigation, isNavigationItemActive } from '../../config/modulePresentation.js';
import './Sidebar.css';

const STORAGE_KEY = 'olimen-gestao:sidebar-open-groups';

function readStoredGroups() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

export function Sidebar({ onNavigate }) {
  const user = getStoredUser();
  const { pathname } = useLocation();
  const visibleEntries = useMemo(() => getVisibleNavigation(user, canAccessPermission), [user]);
  const visibleGroups = visibleEntries.filter((entry) => entry.type === 'module');
  const activeGroupId = visibleGroups.find((group) => (
    group.items.some((item) => isNavigationItemActive(item, pathname))
  ))?.id;
  const [openGroups, setOpenGroups] = useState(() => ({
    ...readStoredGroups(),
    ...(activeGroupId ? { [activeGroupId]: true } : {}),
  }));

  useEffect(() => {
    if (!activeGroupId) return;
    setOpenGroups((current) => (current[activeGroupId]
      ? current
      : { ...current, [activeGroupId]: true }));
  }, [activeGroupId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      // A navegação permanece funcional quando o armazenamento não está disponível.
    }
  }, [openGroups]);

  function toggleGroup(groupId) {
    setOpenGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  return (
    <aside className="sidebar" id="app-sidebar">
      <Link to={getDefaultRoute(user)} className="sidebar__brand" onClick={onNavigate}>OliMen Gestão</Link>
      <nav className="sidebar__nav" aria-label="Navegação principal">
        {visibleEntries.map((entry) => {
          if (entry.type === 'link') {
            const DirectIcon = entry.icon;
            const active = isNavigationItemActive(entry, pathname);
            return (
              <NavLink
                key={entry.id}
                to={entry.to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`sidebar__direct-link ${active ? 'sidebar__direct-link_active' : ''}`}
              >
                <DirectIcon size={18} aria-hidden="true" />
                <span>{entry.label}</span>
              </NavLink>
            );
          }

          const GroupIcon = entry.icon;
          const groupIsActive = entry.items.some((item) => isNavigationItemActive(item, pathname));
          const isOpen = Boolean(openGroups[entry.id]);
          const contentId = `sidebar-group-${entry.id}`;
          return (
            <section className={`sidebar__group ${groupIsActive ? 'sidebar__group_active' : ''}`} key={entry.id}>
              <button
                className="sidebar__group-toggle"
                type="button"
                onClick={() => toggleGroup(entry.id)}
                aria-expanded={isOpen}
                aria-controls={contentId}
              >
                <GroupIcon size={18} aria-hidden="true" />
                <span>{entry.label}</span>
                <ChevronDown className={`sidebar__chevron ${isOpen ? 'sidebar__chevron_open' : ''}`} size={16} aria-hidden="true" />
              </button>
              <div className="sidebar__group-items" id={contentId} hidden={!isOpen}>
                {entry.items.map(({ to, label, icon: ItemIcon, match }) => {
                  const active = isNavigationItemActive({ to, match }, pathname);
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      end
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={`sidebar__link ${active ? 'sidebar__link_active' : ''}`}
                    >
                      <ItemIcon size={15} aria-hidden="true" />
                      <span>{label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
