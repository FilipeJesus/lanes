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
                    <Route path="project/:port" element={<ProjectDetail />} />
                    <Route path="project/:port/session/:name" element={<SessionDetail />} />
                    <Route path="project/:port/workflows" element={<WorkflowBrowser />} />
                    <Route path="workflows" element={<WorkflowBrowser />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
