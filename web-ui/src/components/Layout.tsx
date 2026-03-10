import { NavLink, Outlet, useParams } from 'react-router-dom';
import { ProjectNotificationsProvider } from './ProjectNotificationsProvider';
import styles from '../styles/Layout.module.css';

export function Layout() {
    const { projectId } = useParams<{ projectId: string }>();

    return (
        <ProjectNotificationsProvider projectId={projectId}>
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
        </ProjectNotificationsProvider>
    );
}
