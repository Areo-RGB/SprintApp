import org.gradle.testing.jacoco.tasks.JacocoReport
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

val flatBuffersSchemaDir = layout.projectDirectory.dir("src/main/fbs")
val generatedFlatBuffersDir = layout.buildDirectory.dir("generated/source/flatbuffers/kotlin")
val defaultTcpHostIp = "\"192.168.0.100-192.168.0.110\""
val defaultTcpHostPort = "9000"

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("jacoco")
}

android {
    namespace = "com.paul.sprintsync"
    compileSdk = 35

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "sync.sprint"
        minSdk = 24
        targetSdk = 35
        versionCode = 6
        versionName = "1.0.5"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("boolean", "TCP_ONLY", "true")
        buildConfigField("String", "TCP_HOST_IP", defaultTcpHostIp)
        buildConfigField("int", "TCP_HOST_PORT", defaultTcpHostPort)
        buildConfigField("String", "AUTO_START_ROLE", "\"none\"")
        buildConfigField("String", "DEVICE_PROFILE", "\"default\"")
        buildConfigField("boolean", "HOST_CONTROLLER_ONLY", "false")
        buildConfigField("String", "UPDATE_CHECK_URL", "\"https://api.github.com/repos/Areo-RGB/SprintApp/releases/latest\"")
        resValue("string", "app_name", "Sprint Sync")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }

}

dependencies {
    implementation("androidx.camera:camera-core:1.5.3")
    implementation("androidx.camera:camera-camera2:1.5.3")
    implementation("androidx.camera:camera-lifecycle:1.5.3")
    implementation("androidx.camera:camera-view:1.5.3")
    implementation("androidx.concurrent:concurrent-futures:1.2.0")
    implementation("com.google.guava:guava:33.5.0-android")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("com.google.flatbuffers:flatbuffers-java:25.2.10")
    implementation("androidx.compose.ui:ui:1.7.8")
    implementation("androidx.compose.material3:material3:1.3.1")
    implementation("androidx.compose.ui:ui-tooling-preview:1.7.8")
    debugImplementation("androidx.compose.ui:ui-tooling:1.7.8")
    debugImplementation("androidx.compose.ui:ui-test-manifest:1.7.8")

    testImplementation("junit:junit:4.13.2")
    testImplementation(kotlin("test"))
    testImplementation("io.mockk:mockk:1.13.13")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("app.cash.turbine:turbine:1.1.0")
    testImplementation("androidx.arch.core:core-testing:2.2.0")
    testImplementation("org.robolectric:robolectric:4.14.1")

    androidTestImplementation("androidx.test:core-ktx:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4:1.7.8")
}

tasks.register("generateFlatBuffersKotlin") {
    val schemas = fileTree(flatBuffersSchemaDir) {
        include("**/*.fbs")
    }

    inputs.files(schemas)
    outputs.dir(generatedFlatBuffersDir)

    doLast {
        val schemaFiles = schemas.files.sortedBy { it.absolutePath }
        if (schemaFiles.isEmpty()) {
            return@doLast
        }

        val outputDir = generatedFlatBuffersDir.get().asFile
        outputDir.mkdirs()

        val command = mutableListOf("flatc", "--kotlin", "-o", outputDir.absolutePath)
        command.addAll(schemaFiles.map { it.absolutePath })

        val generationResult = runCatching {
            exec {
                commandLine(command)
            }
        }
        if (generationResult.isFailure) {
            logger.warn(
                "Skipping FlatBuffers generation because flatc is unavailable: ${generationResult.exceptionOrNull()?.message}",
            )
        }
    }
}

tasks.withType<KotlinCompile>().configureEach {
    dependsOn("generateFlatBuffersKotlin")
}

jacoco {
    toolVersion = "0.8.13"
}

tasks.withType<Test>().configureEach {
    finalizedBy(tasks.named("jacocoTestReport"))
}

tasks.register<JacocoReport>("jacocoTestReport") {
    dependsOn("testDebugUnitTest")

    reports {
        xml.required.set(true)
        html.required.set(true)
        csv.required.set(false)
    }

    val coverageExclusions =
        listOf(
            "**/R.class",
            "**/R$*.class",
            "**/BuildConfig.*",
            "**/Manifest*.*",
            "**/*Test*.*",
            "android/**/*.*",
        )

    val kotlinClasses =
        fileTree("${layout.buildDirectory.get()}/tmp/kotlin-classes/debug") {
            exclude(coverageExclusions)
        }

    classDirectories.setFrom(files(kotlinClasses))
    sourceDirectories.setFrom(files("src/main/java", "src/main/kotlin"))
    executionData.setFrom(
        fileTree(layout.buildDirectory.get().asFile) {
            include("outputs/unit_test_code_coverage/debugUnitTest/testDebugUnitTest.exec")
            include("jacoco/testDebugUnitTest.exec")
        },
    )
}
