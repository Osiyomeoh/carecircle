const { withMainActivity } = require("expo/config-plugins");
const {
  mergeContents,
} = require("@expo/config-plugins/build/utils/generateCode");

const withAndroidMainActivityImport = (config) => {
  return withMainActivity(config, (config) => {
    const newSrc = [
      "import android.view.KeyEvent",
      "import com.github.kevinejohn.keyevent.KeyEventModule",
    ];
    const newConfig = mergeContents({
      tag: "react-native-keyevent-import",
      src: config.modResults.contents,
      newSrc: newSrc.join("\n"),
      anchor: `import`,
      offset: 1,
      comment: "//",
    });
    return {
      ...config,
      modResults: newConfig,
    };
  });
};

const withAndroidMainActivityBody = (config) => {
  return withMainActivity(config, (config) => {
    const newSrc = [
      "override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {",
      "  KeyEventModule.getInstance().onKeyDownEvent(keyCode, event)",
      "  super.onKeyDown(keyCode, event)",
      "  return true",
      "}",
      "",
      "override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {",
      "  KeyEventModule.getInstance().onKeyUpEvent(keyCode, event)",
      "  super.onKeyUp(keyCode, event)",
      "  return true",
      "}",
      "",
      "override fun onKeyMultiple(keyCode: Int, repeatCount: Int, event: KeyEvent): Boolean {",
      "  KeyEventModule.getInstance().onKeyMultipleEvent(keyCode, repeatCount, event)",
      "  return super.onKeyMultiple(keyCode, repeatCount, event)",
      "}",
    ];
    const newConfig = mergeContents({
      tag: "react-native-keyevent-body",
      src: config.modResults.contents,
      newSrc: newSrc.join("\n"),
      anchor: `class MainActivity`,
      offset: 1,
      comment: "//",
    });
    return {
      ...config,
      modResults: newConfig,
    };
  });
};

function withKeyEvent(config) {
  config = withAndroidMainActivityImport(config);
  config = withAndroidMainActivityBody(config);
  return config;
}

module.exports = withKeyEvent;
