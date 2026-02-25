plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.25"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.lanes.intellij"
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
        pluginVerifier()
        zipSigner()
        instrumentationTools()
    }

    // JSON serialization
    implementation("com.google.code.gson:gson:2.11.0")

    // Coroutines Swing dispatcher (required for Dispatchers.Main on JVM/Swing)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-swing:1.7.3")

    // Testing
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")
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
    }

    buildSearchableOptions {
        enabled = false
    }

    // Bundle compiled bridge JS into the plugin distribution.
    // Prerequisite: run 'npm run compile' (or 'npx tsc -p .') in the project root
    // to produce the out/ directory before building the IntelliJ plugin.
    prepareSandbox {
        doFirst {
            val bridgeServer = file("${projectDir}/../out/bridge/server.js")
            if (!bridgeServer.exists()) {
                throw GradleException(
                    "Compiled bridge not found at ${bridgeServer.absolutePath}. " +
                        "Run 'npm run compile' in the project root first."
                )
            }
        }

        // Copy compiled bridge JS (Node.js cannot run .ts directly)
        from("${projectDir}/../out/bridge") {
            include("**/*.js")
            into("${rootProject.name}/bridge")
        }

        // Copy compiled core modules that the bridge imports via ../core/
        from("${projectDir}/../out/core") {
            include("**/*.js")
            into("${rootProject.name}/core")
        }
    }
}
