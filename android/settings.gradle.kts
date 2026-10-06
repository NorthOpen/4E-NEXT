// 依赖仓库。
//
// google() 必须排在前面：AndroidX 的构件只在 Google Maven 上有，
// 放后面会让 Gradle 先去 Central 白跑一趟（首次构建能慢出好几分钟）。
//
// 国内网络下 mavenCentral 偶尔很慢时，可以在 ~/.gradle/init.gradle.kts 里插镜像；
// 不写进仓库，因为镜像地址因人而异，写死了反而害了别的贡献者。
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "4E NEXT"
include(":app")
