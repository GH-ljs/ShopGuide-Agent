import { defineConfig } from "@tarojs/cli";

export default defineConfig(async (merge) => {
  const baseConfig = {
    projectName: "shopguide-agent-app",
    date: "2026-07-09",
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      828: 1.81 / 2
    },
    sourceRoot: "src",
    outputRoot: "dist",
    plugins: ["@tarojs/plugin-framework-react"],
    framework: "react",
    compiler: {
      type: "webpack5",
      prebundle: {
        enable: false
      }
    },
    cache: {
      enable: false
    },
    sass: {
      data: ""
    },
    mini: {
      postcss: {
        pxtransform: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false
        }
      }
    },
    h5: {
      publicPath: "/",
      staticDirectory: "static",
      postcss: {
        pxtransform: {
          enable: false
        },
        cssModules: {
          enable: false
        }
      },
      output: {
        filename: "js/[name].[hash:8].js",
        chunkFilename: "js/[name].[chunkhash:8].js"
      },
      devServer: {
        host: "127.0.0.1",
        port: 5174
      }
    }
  };

  return merge({}, baseConfig);
});
