package app.banbanyeok.server.artifact

import io.kotest.core.spec.style.DescribeSpec

// 채택한 에뮬레이터: fake-gcs-server (선정 근거는 docs/setup/p3-notes.md).
class FakeGcsServerArtifactStoreTest :
    DescribeSpec({
        val emulator = Emulators.running.getValue(Emulator.FAKE_GCS)
        include("GCS store on fake-gcs-server", artifactStoreContract { emulator.newBucketStore() })
    })

// 비교용: GCS_EMULATOR_COMPARE=1 일 때만 floci-gcp로 같은 계약을 다시 돌린다(이미지가 커서 CI 기본에서는 제외).
class FlociGcsArtifactStoreTest :
    DescribeSpec({
        if (System.getenv("GCS_EMULATOR_COMPARE") == "1") {
            val emulator = Emulators.running.getValue(Emulator.FLOCI)
            include("GCS store on floci-gcp", artifactStoreContract { emulator.newBucketStore() })
        }
    })
