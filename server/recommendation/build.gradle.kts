// server:recommendation — shared:core의 rank를 서버 요청에 맞게 감싸고 app-logic의 문장 어댑터를 붙인다.
plugins { id("banbanyeok.server-lib") }

dependencies {
    api(project(":shared:core"))
    api(project(":shared:schema"))
    implementation(project(":shared:app-logic"))
}
