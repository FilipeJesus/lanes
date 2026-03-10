import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { ProjectDetail } from './pages/ProjectDetail';
import { SessionDetail } from './pages/SessionDetail';
import { WorkflowBrowser } from './pages/WorkflowBrowser';

export function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<Layout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="project/:projectId" element={<ProjectDetail />} />
                    <Route path="project/:projectId/session/:name" element={<SessionDetail />} />
                    <Route path="project/:projectId/workflows" element={<WorkflowBrowser />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
