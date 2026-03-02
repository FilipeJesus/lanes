plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.25"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.lanes.jetbrainsIde"
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        create(
            providers.gradleProperty("platformType"),
            providers.gradleProperty("platformVersion")
        )
        bundledPlugin("Git4Idea")
        testFramework(org.jetbrains.intellij.platform.gradle.TestFrameworkType.Platform)
        pluginVerifier()
        zipSigner()
        instrumentationTools()
    }

    // JSON serialization
    implementation("com.google.code.gson:gson:2.11.0")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")
    testRuntimeOnly("org.junit.jupiter:junit-jupiter-engine:5.10.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.10.0")
    testRuntimeOnly("org.junit.vintage:junit-vintage-engine:5.10.0")
}

kotlin {
    jvmToolchain(17)
}

intellijPlatform {
    pluginConfiguration {
        name = "Lanes: AI Session Manager"
        version = providers.gradleProperty("pluginVersion")

        ideaVersion {
            sinceBuild = "241"
            untilBuild = provider { null }
        }
    }

    pluginVerification {
        ides {
            recommended()
        }
    }
}

tasks {
    test {
        useJUnitPlatform()
        // BridgeRuntimeSmokeTest needs the packaged plugin sandbox
        // (bridge JS + node_modules) produced by prepareSandbox.
        dependsOn(prepareSandbox)
    }

    buildSearchableOptions {
        enabled = false
    }

    // Bundle compiled jetbrains-ide-bridge JS into the plugin distribution.
    // Prerequisite: run 'npm run compile' (or 'npx tsc -p .') in the project root
    // to produce the out/ directory before building the JetBrains IDE plugin.
    prepareSandbox {
        doFirst {
            val bridgeServer = file("${projectDir}/../out/jetbrains-ide-bridge/server.js")
            if (!bridgeServer.exists()) {
                throw GradleException(
                    "Compiled bridge not found at ${bridgeServer.absolutePath}. " +
                        "Run 'npm run compile' in the project root first."
                )
            }
        }

        // Copy compiled jetbrains-ide-bridge JS (Node.js cannot run .ts directly)
        from("${projectDir}/../out/jetbrains-ide-bridge") {
            include("**/*.js")
            into("${rootProject.name}/jetbrains-ide-bridge")
        }

        // Copy compiled core modules that the bridge imports via ../core/
        from("${projectDir}/../out/core") {
            include("**/*.js")
            into("${rootProject.name}/core")
        }

        // Copy compiled MCP server modules used by workflow integrations.
        from("${projectDir}/../out/mcp") {
            include("**/*.js")
            into("${rootProject.name}/mcp")
        }

        // Copy built-in workflow templates used by workflow.list(includeBuiltin=true).
        from("${projectDir}/../workflows") {
            include("**/*.yaml")
            into("${rootProject.name}/workflows")
        }

        // Bundle Node.js runtime dependencies required by jetbrains-ide-bridge/core at runtime.
        // These are regular npm dependencies imported from compiled JS.
        from("${projectDir}/../node_modules/yaml") {
            into("${rootProject.name}/node_modules/yaml")
        }
        from("${projectDir}/../node_modules/@iarna/toml") {
            into("${rootProject.name}/node_modules/@iarna/toml")
        }
        from("${projectDir}/../node_modules/@modelcontextprotocol/sdk") {
            into("${rootProject.name}/node_modules/@modelcontextprotocol/sdk")
        }
        from("${projectDir}/../node_modules/chokidar") {
            into("${rootProject.name}/node_modules/chokidar")
        }
        from("${projectDir}/../node_modules/readdirp") {
            into("${rootProject.name}/node_modules/readdirp")
        }
        from("${projectDir}/../node_modules/picomatch") {
            into("${rootProject.name}/node_modules/picomatch")
        }
    }
}
