import * as fsPromises from "fs/promises";
import type { CodeAgent } from "../codeAgents";

type SettingsFormat = {
    read(filePath: string): Promise<Record<string, unknown>>;
    write(filePath: string, data: Record<string, unknown>): Promise<void>;
};

const jsonFormat: SettingsFormat = {
    async read(filePath) {
        return JSON.parse(
            await fsPromises.readFile(filePath, "utf-8"),
        ) as Record<string, unknown>;
    },
    async write(filePath, data) {
        await fsPromises.writeFile(
            filePath,
            JSON.stringify(data, null, 2),
            "utf-8",
        );
    },
};

const tomlFormat: SettingsFormat = {
    async read(filePath) {
        const TOML = await import("@iarna/toml");
        return TOML.parse(
            await fsPromises.readFile(filePath, "utf-8"),
        ) as Record<string, unknown>;
    },
    async write(filePath, data) {
        const TOML = await import("@iarna/toml");
        await fsPromises.writeFile(
            filePath,
            TOML.stringify(data as Parameters<typeof TOML.stringify>[0]),
            "utf-8",
        );
    },
};

export function getSettingsFormat(codeAgent?: CodeAgent): SettingsFormat {
    const settingsFileName = codeAgent?.getSettingsFileName();
    if (settingsFileName?.endsWith(".toml")) {
        return tomlFormat;
    }
    return jsonFormat;
}
