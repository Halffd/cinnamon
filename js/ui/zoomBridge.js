// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Signals = imports.signals;

const MUFFIN_ZOOM_SERVICE = 'org.cinnamon.Muffin.Zoom';
const MUFFIN_ZOOM_PATH = '/org/cinnamon/Muffin/Zoom';

const MuffinZoomIface =
    '<node> \
    <interface name="org.cinnamon.Muffin.Zoom"> \
    <method name="ZoomIn"> \
        <arg type="d" direction="in" /> \
    </method> \
    <method name="ZoomOut"> \
        <arg type="d" direction="in" /> \
    </method> \
    <method name="ResetZoom"> \
    </method> \
    <method name="SetZoomLevel"> \
        <arg type="d" direction="in" /> \
    </method> \
    <method name="GetZoomLevel"> \
        <arg type="d" direction="out" /> \
    </method> \
    <method name="GetZoomActive"> \
        <arg type="b" direction="out" /> \
    </method> \
    <method name="ToggleZoomMode"> \
    </method> \
    <method name="ZoomInForMonitor"> \
        <arg type="i" direction="in" /> \
        <arg type="d" direction="in" /> \
    </method> \
    <method name="ZoomOutForMonitor"> \
        <arg type="i" direction="in" /> \
        <arg type="d" direction="in" /> \
    </method> \
    <method name="ResetZoomForMonitor"> \
        <arg type="i" direction="in" /> \
    </method> \
    <method name="SetZoomLevelForMonitor"> \
        <arg type="i" direction="in" /> \
        <arg type="d" direction="in" /> \
    </method> \
    <method name="GetZoomLevelForMonitor"> \
        <arg type="i" direction="in" /> \
        <arg type="d" direction="out" /> \
    </method> \
    <method name="GetZoomActiveForMonitor"> \
        <arg type="i" direction="in" /> \
        <arg type="b" direction="out" /> \
    </method> \
<method name="SetMouseTrackingForMonitor"> \
    <arg type="i" direction="in" /> \
    <arg type="i" direction="in" /> \
  </method> \
  <method name="SetViewportForMonitor"> \
    <arg type="i" direction="in" /> \
    <arg type="d" direction="in" /> \
    <arg type="d" direction="in" /> \
  </method> \
</interface> \
    </node>';

const MouseTrackingMode = {
    CENTERED: 0,
    PROPORTIONAL: 1,
    PUSH: 2
};

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
