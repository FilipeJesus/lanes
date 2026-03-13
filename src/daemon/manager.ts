import { SessionHandlerService } from '../core/services/SessionHandlerService';
import { getWorktreesFolder, initializeGlobalStorageContext } from '../core/session/SessionDataService';
import type { IHandlerContext } from '../core/interfaces/IHandlerContext';
import { getAgent } from '../core/codeAgents';
import { DaemonConfigStore } from './config';
import { DaemonNotificationEmitter } from './notifications';
import { DaemonFileWatchManager } from './fileWatcher';
import {
    type RegisteredProjectEntry,
    listRegisteredProjects,
    getRegisteredProjectById,
} from './registry';

export interface ProjectRuntime {
    project: RegisteredProjectEntry;
    startedAt: string;
    context: IHandlerContext;
    handlerService: SessionHandlerService;
    notificationEmitter: DaemonNotificationEmitter;
    fileWatchManager: DaemonFileWatchManager;
}

export class GlobalDaemonProjectManager {
    private readonly runtimes = new Map<string, ProjectRuntime>();

    async listProjects(): Promise<RegisteredProjectEntry[]> {
        return listRegisteredProjects();
    }

    async getProject(projectId: string): Promise<RegisteredProjectEntry> {
        const project = await getRegisteredProjectById(projectId);
        if (!project) {
            throw new Error(`Unknown project: ${projectId}`);
        }
        return project;
    }

    async getRuntime(projectId: string): Promise<ProjectRuntime> {
        const existing = this.runtimes.get(projectId);
        if (existing) {
            return existing;
        }

        const project = await this.getProject(projectId);
        const configStore = new DaemonConfigStore(project.workspaceRoot);
        await configStore.initialize();
        const defaultAgentName = (configStore.get('lanes.defaultAgent') as string | undefined) ?? 'claude';
        initializeGlobalStorageContext('', project.workspaceRoot, getAgent(defaultAgentName) ?? getAgent('claude') ?? undefined);

        const notificationEmitter = new DaemonNotificationEmitter();
        const fileWatchManager = new DaemonFileWatchManager(notificationEmitter);

        const context: IHandlerContext = {
            workspaceRoot: project.workspaceRoot,
            config: configStore,
            notificationEmitter,
            fileWatchManager,
        };

        const handlerService = new SessionHandlerService(context);
        const worktreesFolder = getWorktreesFolder(
            configStore.get('lanes.worktreesFolder') as string | undefined
        );
        fileWatchManager.setupAutoWatching(project.workspaceRoot, worktreesFolder);

        const runtime: ProjectRuntime = {
            project,
            startedAt: new Date().toISOString(),
            context,
            handlerService,
            notificationEmitter,
            fileWatchManager,
        };

        this.runtimes.set(projectId, runtime);
        return runtime;
    }

    dispose(): void {
        for (const runtime of this.runtimes.values()) {
            runtime.fileWatchManager.dispose();
        }
        this.runtimes.clear();
    }
}
