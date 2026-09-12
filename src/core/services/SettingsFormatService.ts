import * as fsPromises from "fs/promises";
import type { CodeAgent } from "../codeAgents";

type SettingsFormat = {
    read(filePath: string): Promise<Record<string, unknown>>;
    write(filePath: string, data: Record<string, unknown>): Promise<void>;
};

function stripJsonComments(content: string): string {
    let result = "";
    let i = 0;
    let inString = false;
    let stringChar = "";

    while (i < content.length) {
        if (inString) {
            if (content[i] === "\\") {
                result += content[i] + (content[i + 1] || "");
                i += 2;
                continue;
            }
            if (content[i] === stringChar) {
                inString = false;
            }
            result += content[i];
            i++;
            continue;
        }

        if (content[i] === '"' || content[i] === "'") {
            inString = true;
            stringChar = content[i];
            result += content[i];
            i++;
            continue;
        }

        if (content[i] === "/" && content[i + 1] === "/") {
            while (i < content.length && content[i] !== "\n") {
                i++;
            }
            if (i < content.length && content[i] === "\n") {
                result += "\n";
                i++;
            }
            continue;
        }

        if (content[i] === "/" && content[i + 1] === "*") {
            i += 2;
            while (
                i < content.length &&
                !(content[i] === "*" && content[i + 1] === "/")
            ) {
                i++;
            }
            if (i < content.length) {
                i += 2;
            }
            continue;
        }

        result += content[i];
        i++;
    }

    return result;
}

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

const jsoncFormat: SettingsFormat = {
    async read(filePath) {
        const content = await fsPromises.readFile(filePath, "utf-8");
        return JSON.parse(stripJsonComments(content)) as Record<
            string,
            unknown
        >;
    },
    write: jsonFormat.write,
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
    if (settingsFileName?.endsWith(".jsonc")) {
        return jsoncFormat;
    }
    return jsonFormat;
}
