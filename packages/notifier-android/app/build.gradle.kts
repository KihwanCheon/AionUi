plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val firebaseConfig = file("google-services.json")

if (firebaseConfig.exists()) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.aionui.notifier"
    compileSdk = 35
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "com.mabobsa.aionnotifier"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "backend"
    productFlavors {
        create("preview") {
            dimension = "backend"
            applicationIdSuffix = ".preview"
        }
        create("firebase") { dimension = "backend" }
    }

    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

tasks.configureEach {
    // The preview application id intentionally has no Firebase client registration.
    if (name.startsWith("processPreview") && name.endsWith("GoogleServices")) enabled = false
    if (name in setOf("preFirebaseDebugBuild", "preFirebaseReleaseBuild")) {
        doFirst {
            check(firebaseConfig.exists()) {
                "Place Firebase Android config at app/google-services.json first."
            }
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.05.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.fragment:fragment-ktx:1.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    "firebaseImplementation"(platform("com.google.firebase:firebase-bom:34.0.0"))
    "firebaseImplementation"("com.google.firebase:firebase-messaging")
    "firebaseImplementation"("com.google.firebase:firebase-auth")
    "firebaseImplementation"("com.google.firebase:firebase-firestore")
    "firebaseImplementation"("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
    "firebaseImplementation"("androidx.work:work-runtime-ktx:2.10.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
