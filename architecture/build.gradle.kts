plugins { id("banbanyeok.kotlin-jvm") }
dependencies { testImplementation(libs.konsist) }
tasks.test { workingDir(rootProject.projectDir) }
