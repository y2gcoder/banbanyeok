plugins { kotlin("multiplatform") version "2.4.21" }
repositories { mavenCentral() }
kotlin {
    js(IR) {
        nodejs()
        useEsModules()
        generateTypeScriptDefinitions()
        binaries.library()
    }
    jvm()
}
