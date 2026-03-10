import { NavLink, Outlet } from 'react-router-dom';
import styles from '../styles/Layout.module.css';

export function Layout() {
    return (
        <div className={styles.app}>
            <header className={styles.header}>
                <NavLink to="/" className={styles.headerLogo}>
                    Lanes
                </NavLink>
            </header>

            <main className={styles.main}>
                <Outlet />
            </main>
        </div>
    );
}
