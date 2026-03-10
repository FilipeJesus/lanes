import { useParams } from 'react-router-dom';
import { useDaemonConnection } from '../hooks/useDaemonConnection';
import { SessionDetailPanel } from '../components/SessionDetailPanel';

export function SessionDetail() {
    const { projectId, name } = useParams<{ projectId: string; name: string }>();
    const decodedName = name ? decodeURIComponent(name) : '';
    const { apiClient, sseClient, daemonInfo, loading, error } = useDaemonConnection(projectId);

    if (!projectId || !decodedName) {
        return null;
    }

    return (
        <SessionDetailPanel
            projectId={projectId}
            sessionName={decodedName}
            apiClient={apiClient}
            sseClient={sseClient}
            daemonInfo={daemonInfo}
            connectionLoading={loading}
            connectionError={error}
            showBreadcrumb
        />
    );
}
