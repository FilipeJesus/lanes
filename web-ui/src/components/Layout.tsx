import { NavLink, Outlet } from 'react-router-dom';
import styles from '../styles/Layout.module.css';

export function Layout() {
    return (
        <div className={styles.app}>
            <header className={styles.header}>
                <NavLink to="/" className={styles.headerLogo}>
                    Lanes
                </NavLink>
                <nav className={styles.headerNav}>
                    <NavLink
                        to="/"
                        end
                        className={({ isActive }) =>
                            `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                        }
                    >
                        Dashboard
                    </NavLink>
                    <NavLink
                        to="/workflows"
                        className={({ isActive }) =>
                            `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                        }
                    >
                        Workflows
                    </NavLink>
                </nav>
            </header>

            <div className={styles.body}>
                <aside className={styles.sidebar}>
                    <div className={styles.sidebarSection}>
                        <div className={styles.sidebarSectionTitle}>Navigation</div>
                        <NavLink
                            to="/"
                            end
                            className={({ isActive }) =>
                                `${styles.sidebarLink} ${isActive ? styles.sidebarLinkActive : ''}`
                            }
                        >
                            Dashboard
                        </NavLink>
                        <NavLink
                            to="/workflows"
                            className={({ isActive }) =>
                                `${styles.sidebarLink} ${isActive ? styles.sidebarLinkActive : ''}`
                            }
                        >
                            Workflows
                        </NavLink>
                    </div>
                </aside>

                <main className={styles.main}>
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
