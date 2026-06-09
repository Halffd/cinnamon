// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Signals = imports.signals;

const MUFFIN_ZOOM_SERVICE = 'org.cinnamon.Muffin.Zoom';
const MUFFIN_ZOOM_PATH = '/org/cinnamon/Muffin/Zoom';

const MuffinZoomIface = `
<node>
<interface name="org.cinnamon.Muffin.Zoom">
<method name="ZoomIn">
<arg type="d" direction="in" />
</method>
<method name="ZoomOut">
<arg type="d" direction="in" />
</method>
<method name="ResetZoom">
</method>
<method name="SetZoomLevel">
<arg type="d" direction="in" />
</method>
<method name="GetZoomLevel">
<arg type="d" direction="out" />
</method>
<method name="GetZoomActive">
<arg type="b" direction="out" />
</method>
<method name="ToggleZoomMode">
</method>
<method name="ToggleZoom">
</method>
<method name="ZoomInForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="in" />
</method>
<method name="ZoomOutForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="in" />
</method>
<method name="ResetZoomForMonitor">
<arg type="i" direction="in" />
</method>
<method name="SetZoomLevelForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="in" />
</method>
<method name="GetZoomLevelForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="out" />
</method>
<method name="GetZoomActiveForMonitor">
<arg type="i" direction="in" />
<arg type="b" direction="out" />
</method>
<method name="SetMouseTrackingForMonitor">
<arg type="i" direction="in" />
<arg type="i" direction="in" />
</method>
<method name="SetViewportForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="in" />
<arg type="d" direction="in" />
</method>
<method name="SetColorEffectsForMonitor">
<arg type="i" direction="in" />
<arg type="b" direction="in" />
<arg type="d" direction="in" />
<arg type="d" direction="in" />
<arg type="d" direction="in" />
<arg type="d" direction="in" />
<arg type="d" direction="in" />
<arg type="d" direction="in" />
<arg type="d" direction="in" />
</method>
<method name="SetZoomScopeForMonitor">
<arg type="i" direction="in" />
<arg type="i" direction="in" />
</method>
<method name="GetZoomScopeForMonitor">
<arg type="i" direction="in" />
<arg type="i" direction="out" />
</method>
<method name="ToggleZoomForMonitor">
<arg type="i" direction="in" />
</method>
<method name="SetZoomModeForMonitor">
<arg type="i" direction="in" />
<arg type="i" direction="in" />
</method>
<method name="GetZoomModeForMonitor">
<arg type="i" direction="in" />
<arg type="i" direction="out" />
</method>
<method name="SetZoomSizeForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="in" />
<arg type="d" direction="in" />
</method>
<method name="GetZoomSizeForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="out" />
<arg type="d" direction="out" />
</method>
<method name="PreviousZoomForMonitor">
<arg type="i" direction="in" />
</method>
<method name="SetZoomOnTitlebarForMonitor">
<arg type="i" direction="in" />
<arg type="b" direction="in" />
</method>
<method name="SetZoomOnFullscreenForMonitor">
<arg type="i" direction="in" />
<arg type="b" direction="in" />
</method>
<method name="SetZoomStepForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="in" />
</method>
<method name="GetZoomStepForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="out" />
</method>
<method name="IncreaseStepForMonitor">
<arg type="i" direction="in" />
</method>
<method name="DecreaseStepForMonitor">
<arg type="i" direction="in" />
</method>
<method name="ResetStepForMonitor">
<arg type="i" direction="in" />
</method>
<method name="SetMinZoomForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="in" />
</method>
<method name="GetMinZoomForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="out" />
</method>
<method name="SetMaxZoomForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="in" />
</method>
<method name="GetMaxZoomForMonitor">
<arg type="i" direction="in" />
<arg type="d" direction="out" />
</method>
</interface>
    </node>
`;

const MouseTrackingMode = {
  CENTERED: 0,
  PROPORTIONAL: 1,
  PUSH: 2
};

const ZoomScope = {
  ANYWHERE: 0,
  DESKTOP: 1,
  TITLEBAR: 2,
  TASKBAR: 3
};

const ZoomMode = {
  FULLSCREEN: 0,
  LENS: 1,
  TOP_HALF: 2,
  BOTTOM_HALF: 3,
  LEFT_HALF: 4,
  RIGHT_HALF: 5
};

const DEFAULT_ZOOM_STEP = 1.6;
const DEFAULT_MIN_ZOOM = 1.0;
const DEFAULT_MAX_ZOOM = 16.0;

var ZoomBridge = class ZoomBridge {
  constructor() {
    this._proxy = null;
    this._available = false;
    this._initProxy();
  }

  _initProxy() {
    let ProxyConstructor = Gio.DBusProxy.makeProxyWrapper(MuffinZoomIface);
    try {
      this._proxy = new ProxyConstructor(
        Gio.DBus.session,
        MUFFIN_ZOOM_SERVICE,
        MUFFIN_ZOOM_PATH,
        this._onProxyReady.bind(this)
      );
    } catch (e) {
      log('ZoomBridge: failed to create D-Bus proxy: ' + e.message);
      this._available = false;
    }
  }

  _onProxyReady(proxy, error) {
    if (error) {
      log('ZoomBridge: D-Bus proxy error: ' + error.message);
      this._available = false;
      return;
    }
    this._available = true;
    this.emit('available');
  }

  get available() {
    return this._available;
  }

  zoomIn(level) {
    if (!this._available) return;
    this._proxy.ZoomInRemote(level, (result, error) => {
      if (error) log('ZoomBridge.ZoomIn: ' + error.message);
    });
  }

  zoomOut(level) {
    if (!this._available) return;
    this._proxy.ZoomOutRemote(level, (result, error) => {
      if (error) log('ZoomBridge.ZoomOut: ' + error.message);
    });
  }

  resetZoom() {
    if (!this._available) return;
    this._proxy.ResetZoomRemote((result, error) => {
      if (error) log('ZoomBridge.ResetZoom: ' + error.message);
    });
  }

  setZoomLevel(level) {
    if (!this._available) return;
    this._proxy.SetZoomLevelRemote(level, (result, error) => {
      if (error) log('ZoomBridge.SetZoomLevel: ' + error.message);
    });
  }

  getZoomLevel(callback) {
    if (!this._available) {
      if (callback) callback(1.0, new Error('not available'));
      return;
    }
    this._proxy.GetZoomLevelRemote((result, error) => {
      if (callback) callback(result, error);
    });
  }

  getZoomActive(callback) {
    if (!this._available) {
      if (callback) callback(false, new Error('not available'));
      return;
    }
    this._proxy.GetZoomActiveRemote((result, error) => {
      if (callback) callback(result, error);
    });
  }

  toggleZoomMode() {
    if (!this._available) return;
    this._proxy.ToggleZoomModeRemote((result, error) => {
      if (error) log('ZoomBridge.ToggleZoomMode: ' + error.message);
    });
  }

  toggleZoom() {
    if (!this._available) return;
    this._proxy.ToggleZoomRemote((result, error) => {
      if (error) log('ZoomBridge.ToggleZoom: ' + error.message);
    });
  }

  zoomInForMonitor(monitorIndex, level) {
    if (!this._available) return;
    this._proxy.ZoomInForMonitorRemote(monitorIndex, level, (result, error) => {
      if (error) log('ZoomBridge.ZoomInForMonitor: ' + error.message);
    });
  }

  zoomOutForMonitor(monitorIndex, level) {
    if (!this._available) return;
    this._proxy.ZoomOutForMonitorRemote(monitorIndex, level, (result, error) => {
      if (error) log('ZoomBridge.ZoomOutForMonitor: ' + error.message);
    });
  }

  resetZoomForMonitor(monitorIndex) {
    if (!this._available) return;
    this._proxy.ResetZoomForMonitorRemote(monitorIndex, (result, error) => {
      if (error) log('ZoomBridge.ResetZoomForMonitor: ' + error.message);
    });
  }

  setZoomLevelForMonitor(monitorIndex, level) {
    if (!this._available) return;
    this._proxy.SetZoomLevelForMonitorRemote(monitorIndex, level, (result, error) => {
      if (error) log('ZoomBridge.SetZoomLevelForMonitor: ' + error.message);
    });
  }

  getZoomLevelForMonitor(monitorIndex, callback) {
    if (!this._available) {
      if (callback) callback(1.0, new Error('not available'));
      return;
    }
    this._proxy.GetZoomLevelForMonitorRemote(monitorIndex, (result, error) => {
      if (callback) callback(result, error);
    });
  }

  getZoomActiveForMonitor(monitorIndex, callback) {
    if (!this._available) {
      if (callback) callback(false, new Error('not available'));
      return;
    }
    this._proxy.GetZoomActiveForMonitorRemote(monitorIndex, (result, error) => {
      if (callback) callback(result, error);
    });
  }

  setMouseTrackingForMonitor(monitorIndex, mode) {
    if (!this._available) return;
    this._proxy.SetMouseTrackingForMonitorRemote(monitorIndex, mode, (result, error) => {
      if (error) log('ZoomBridge.SetMouseTrackingForMonitor: ' + error.message);
    });
  }

  setViewportForMonitor(monitorIndex, viewportX, viewportY) {
    if (!this._available) return;
    this._proxy.SetViewportForMonitorRemote(monitorIndex, viewportX, viewportY, (result, error) => {
      if (error) log('ZoomBridge.SetViewportForMonitor: ' + error.message);
    });
  }

  setColorEffectsForMonitor(monitorIndex, invertLightness, saturation,
    brightnessRed, brightnessGreen, brightnessBlue,
    contrastRed, contrastGreen, contrastBlue) {
    if (!this._available) return;
    this._proxy.SetColorEffectsForMonitorRemote(
      monitorIndex, invertLightness, saturation,
      brightnessRed, brightnessGreen, brightnessBlue,
      contrastRed, contrastGreen, contrastBlue,
      (result, error) => {
        if (error) log('ZoomBridge.SetColorEffectsForMonitor: ' + error.message);
      });
  }

  setZoomScopeForMonitor(monitorIndex, scope) {
    if (!this._available) return;
    this._proxy.SetZoomScopeForMonitorRemote(monitorIndex, scope, (result, error) => {
      if (error) log('ZoomBridge.SetZoomScopeForMonitor: ' + error.message);
    });
  }

  getZoomScopeForMonitor(monitorIndex, callback) {
    if (!this._available) {
      if (callback) callback(0, new Error('not available'));
      return;
    }
    this._proxy.GetZoomScopeForMonitorRemote(monitorIndex, (result, error) => {
      if (callback) callback(result, error);
    });
  }

  toggleZoomForMonitor(monitorIndex) {
    if (!this._available) return;
    this._proxy.ToggleZoomForMonitorRemote(monitorIndex, (result, error) => {
      if (error) log('ZoomBridge.ToggleZoomForMonitor: ' + error.message);
    });
  }

  setZoomModeForMonitor(monitorIndex, mode) {
    if (!this._available) return;
    this._proxy.SetZoomModeForMonitorRemote(monitorIndex, mode, (result, error) => {
      if (error) log('ZoomBridge.SetZoomModeForMonitor: ' + error.message);
    });
  }

  getZoomModeForMonitor(monitorIndex, callback) {
    if (!this._available) {
      if (callback) callback(0, new Error('not available'));
      return;
    }
    this._proxy.GetZoomModeForMonitorRemote(monitorIndex, (result, error) => {
      if (callback) callback(result, error);
    });
  }

  setZoomSizeForMonitor(monitorIndex, width, height) {
    if (!this._available) return;
    this._proxy.SetZoomSizeForMonitorRemote(monitorIndex, width, height, (result, error) => {
      if (error) log('ZoomBridge.SetZoomSizeForMonitor: ' + error.message);
    });
  }

  getZoomSizeForMonitor(monitorIndex, callback) {
    if (!this._available) {
      if (callback) callback(0, 0, new Error('not available'));
      return;
    }
    this._proxy.GetZoomSizeForMonitorRemote(monitorIndex, (result, error) => {
      if (callback) callback(result, error);
    });
  }

  previousZoomForMonitor(monitorIndex) {
    if (!this._available) return;
    this._proxy.PreviousZoomForMonitorRemote(monitorIndex, (result, error) => {
      if (error) log('ZoomBridge.PreviousZoomForMonitor: ' + error.message);
    });
  }

  setZoomOnTitlebarForMonitor(monitorIndex, enabled) {
    if (!this._available) return;
    this._proxy.SetZoomOnTitlebarForMonitorRemote(monitorIndex, enabled, (result, error) => {
      if (error) log('ZoomBridge.SetZoomOnTitlebarForMonitor: ' + error.message);
    });
  }

  setZoomOnFullscreenForMonitor(monitorIndex, enabled) {
    if (!this._available) return;
    this._proxy.SetZoomOnFullscreenForMonitorRemote(monitorIndex, enabled, (result, error) => {
      if (error) log('ZoomBridge.SetZoomOnFullscreenForMonitor: ' + error.message);
    });
  }

  setZoomStepForMonitor(monitorIndex, step) {
    if (!this._available) return;
    this._proxy.SetZoomStepForMonitorRemote(monitorIndex, step, (result, error) => {
      if (error) log('ZoomBridge.SetZoomStepForMonitor: ' + error.message);
    });
  }

  getZoomStepForMonitor(monitorIndex, callback) {
    if (!this._available) {
      if (callback) callback(DEFAULT_ZOOM_STEP, new Error('not available'));
      return;
    }
    this._proxy.GetZoomStepForMonitorRemote(monitorIndex, (result, error) => {
      if (callback) callback(result, error);
    });
  }

  increaseStepForMonitor(monitorIndex) {
    if (!this._available) return;
    this._proxy.IncreaseStepForMonitorRemote(monitorIndex, (result, error) => {
      if (error) log('ZoomBridge.IncreaseStepForMonitor: ' + error.message);
    });
  }

  decreaseStepForMonitor(monitorIndex) {
    if (!this._available) return;
    this._proxy.DecreaseStepForMonitorRemote(monitorIndex, (result, error) => {
      if (error) log('ZoomBridge.DecreaseStepForMonitor: ' + error.message);
    });
  }

  resetStepForMonitor(monitorIndex) {
    if (!this._available) return;
    this._proxy.ResetStepForMonitorRemote(monitorIndex, (result, error) => {
      if (error) log('ZoomBridge.ResetStepForMonitor: ' + error.message);
    });
  }

  setMinZoomForMonitor(monitorIndex, minZoom) {
    if (!this._available) return;
    this._proxy.SetMinZoomForMonitorRemote(monitorIndex, minZoom, (result, error) => {
      if (error) log('ZoomBridge.SetMinZoomForMonitor: ' + error.message);
    });
  }

  getMinZoomForMonitor(monitorIndex, callback) {
    if (!this._available) {
      if (callback) callback(DEFAULT_MIN_ZOOM, new Error('not available'));
      return;
    }
    this._proxy.GetMinZoomForMonitorRemote(monitorIndex, (result, error) => {
      if (callback) callback(result, error);
    });
  }

  setMaxZoomForMonitor(monitorIndex, maxZoom) {
    if (!this._available) return;
    this._proxy.SetMaxZoomForMonitorRemote(monitorIndex, maxZoom, (result, error) => {
      if (error) log('ZoomBridge.SetMaxZoomForMonitor: ' + error.message);
    });
  }

  getMaxZoomForMonitor(monitorIndex, callback) {
    if (!this._available) {
      if (callback) callback(DEFAULT_MAX_ZOOM, new Error('not available'));
      return;
    }
    this._proxy.GetMaxZoomForMonitorRemote(monitorIndex, (result, error) => {
      if (callback) callback(result, error);
    });
  }

  destroy() {
    this._proxy = null;
    this._available = false;
  }
};
Signals.addSignalMethods(ZoomBridge.prototype);

let _zoomBridge = null;

function getZoomBridge() {
  if (!_zoomBridge)
    _zoomBridge = new ZoomBridge();
  return _zoomBridge;
}
