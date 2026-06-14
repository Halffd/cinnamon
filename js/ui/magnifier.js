// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Meta = imports.gi.Meta;
const Gio = imports.gi.Gio;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const Signals = imports.signals;

let Atspi;
try {
    Atspi = imports.gi.Atspi;
} catch (e) {
    Atspi = null;
}

const Main = imports.ui.main;
const MagnifierDBus = imports.ui.magnifierDBus;
const ZoomBridge = imports.ui.zoomBridge;
const Params = imports.misc.params;

// Keep enums in sync with GSettings schemas
const MouseTrackingMode = {
    NONE: 0,
    CENTERED: 1,
    PROPORTIONAL: 2,
    PUSH: 3
};

const ScreenPosition = {
    NONE: 0,
    FULL_SCREEN: 1,
    TOP_HALF: 2,
    BOTTOM_HALF: 3,
    LEFT_HALF: 4,
    RIGHT_HALF: 5
};

const LensShape = {
    NONE: 0,
    SQUARE : 1,
    HORIZONTAL : 2,
    VERTICAL : 3
}

const MOUSE_POLL_FREQUENCY = 15;
const CROSSHAIRS_CLIP_SIZE = [100, 100];

// Settings
const APPLICATIONS_SCHEMA       = 'org.cinnamon.desktop.a11y.applications';
const SHOW_KEY                  = 'screen-magnifier-enabled';

const MAGNIFIER_SCHEMA          = 'org.cinnamon.desktop.a11y.magnifier';
const SCREEN_POSITION_KEY       = 'screen-position';
const MAG_FACTOR_KEY            = 'mag-factor';
const LENS_MODE_KEY             = 'lens-mode';
const LENS_SHAPE_KEY            = 'lens-shape';
const CLAMP_MODE_KEY            = 'scroll-at-edges';
const MOUSE_TRACKING_KEY        = 'mouse-tracking';
const SHOW_CROSS_HAIRS_KEY      = 'show-cross-hairs';
const CROSS_HAIRS_THICKNESS_KEY = 'cross-hairs-thickness';
const CROSS_HAIRS_COLOR_KEY     = 'cross-hairs-color';
const CROSS_HAIRS_OPACITY_KEY   = 'cross-hairs-opacity';
const CROSS_HAIRS_LENGTH_KEY    = 'cross-hairs-length';
const CROSS_HAIRS_CLIP_KEY = 'cross-hairs-clip';
const INVERT_LIGHTNESS_KEY = 'invert-lightness';
const COLOR_SATURATION_KEY = 'color-saturation';
const BRIGHTNESS_RED_KEY = 'brightness-red';
const BRIGHTNESS_GREEN_KEY = 'brightness-green';
const BRIGHTNESS_BLUE_KEY = 'brightness-blue';
const CONTRAST_RED_KEY = 'contrast-red';
const CONTRAST_GREEN_KEY = 'contrast-green';
const CONTRAST_BLUE_KEY = 'contrast-blue';
const ZOOM_SCOPE_KEY = 'zoom-scope';
const ZOOM_STEP_KEY = 'zoom-step';
const MIN_ZOOM_KEY = 'min-zoom';
const MAX_ZOOM_KEY = 'max-zoom';
const COMPOSITOR_ZOOM_ENABLED_KEY = 'compositor-zoom-enabled';

const KEYBINDING_SCHEMA = "org.cinnamon.desktop.keybindings"
const ZOOM_IN_KEY = "magnifier-zoom-in"
const ZOOM_OUT_KEY = "magnifier-zoom-out"
const ZOOM_RESET_KEY = "magnifier-zoom-reset"
const ZOOM_TOGGLE_KEY = "magnifier-toggle-zoom"
const ZOOM_PREVIOUS_KEY = "magnifier-zoom-previous"
const ZOOM_MODE_FULLSCREEN_KEY = "magnifier-zoom-mode-fullscreen"
const ZOOM_MODE_LENS_KEY = "magnifier-zoom-mode-lens"
const ZOOM_MODE_TOP_HALF_KEY = "magnifier-zoom-mode-top-half"
const ZOOM_MODE_BOTTOM_HALF_KEY = "magnifier-zoom-mode-bottom-half"
const ZOOM_MODE_LEFT_HALF_KEY = "magnifier-zoom-mode-left-half"
const ZOOM_MODE_RIGHT_HALF_KEY = "magnifier-zoom-mode-right-half"
const ZOOM_ON_TITLEBAR_KEY = "magnifier-zoom-on-titlebar"
const ZOOM_ON_FULLSCREEN_KEY = "magnifier-zoom-on-fullscreen"
const ZOOM_INCREASE_STEP_KEY = "magnifier-zoom-increase-step"
const ZOOM_DECREASE_STEP_KEY = "magnifier-zoom-decrease-step"
const ZOOM_RESET_STEP_KEY = "magnifier-zoom-reset-step"

let magDBusService = null;
var magInputHandler = null;

var MouseSpriteContent = GObject.registerClass({
    Implements: [Clutter.Content],
}, class MouseSpriteContent extends GObject.Object {
    _init() {
        super._init();
        this._scale = 1.0;
        this._monitorScale = 1.0;
        this._texture = null;
    }

    vfunc_get_preferred_size() {
        if (!this._texture)
            return [false, 0, 0];

        let width = this._texture.get_width() / this._scale;
        let height = this._texture.get_height() / this._scale;

        return [true, width, height];
    }

    vfunc_paint_content(actor, node, _paintContext) {
        if (!this._texture)
            return;

        let color = Clutter.Color.get_static(Clutter.StaticColor.WHITE);
        let [minFilter, magFilter] = actor.get_content_scaling_filters();
        let textureNode = new Clutter.TextureNode(this._texture,
                                                  color, minFilter, magFilter);
        textureNode.set_name('MouseSpriteContent');
        node.add_child(textureNode);

        textureNode.add_rectangle(actor.get_content_box());
    }

    _textureScale() {
        if (!this._texture)
            return 1;

        /* This is a workaround to guess the sprite scale; while it works file
         * in normal scenarios, it's not guaranteed to work in all the cases,
         * and so we should actually add an API to mutter that will allow us
         * to know the real spirte texture scaling in order to adapt it to the
         * wanted one. */
        let avgSize = (this._texture.get_width() + this._texture.get_height()) / 2;
        return Math.max (1, Math.floor (avgSize / Meta.prefs_get_cursor_size() + .1));
    }

    _recomputeScale() {
        let scale = this._textureScale() / this._monitorScale;

        if (this._scale != scale) {
            this._scale = scale;
            return true;
        }
        return false;
    }

    get texture() {
        return this._texture;
    }

    set texture(coglTexture) {
        if (this._texture == coglTexture)
            return;

        let oldTexture = this._texture;
        this._texture = coglTexture;
        this.invalidate();

        if (!oldTexture || !coglTexture ||
            oldTexture.get_width() != coglTexture.get_width() ||
            oldTexture.get_height() != coglTexture.get_height()) {
            this._recomputeScale();
            this.invalidate_size();
        }
    }

    get scale() {
        return this._scale;
    }

    set monitorScale(monitorScale) {
        this._monitorScale = monitorScale;
        if (this._recomputeScale())
            this.invalidate_size();
    }
});

var Magnifier = class Magnifier {
    constructor() {
        // Magnifier is a manager of ZoomRegions.
        this._zoomRegions = [];

        this._appSettings = new Gio.Settings({ schema_id: APPLICATIONS_SCHEMA });
        this._settings = new Gio.Settings({ schema_id: MAGNIFIER_SCHEMA });

        this._initialized = false;
        this.updateMagId = 0;
        this.enabled = this._appSettings.get_boolean(SHOW_KEY);
        this._compositorZoomActive = false;

        this._zoomBridge = ZoomBridge.getZoomBridge();
        this._zoomBridge.connect('available', () => {
            if (this.isActive() && !this._compositorZoomActive)
                this._switchToCompositorZoom();
        });

        this._focusCaretTrackingActive = false;
        this._focusListenerId = 0;
        this._caretListenerId = 0;

        this._appSettings.connect('changed::' + SHOW_KEY,
            () => {
                this.enabled = this._appSettings.get_boolean(SHOW_KEY);
                let factor = parseFloat(this._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
                if (this.enabled) {
                    if (this._compositorZoomActive) {
                        // Compositor already set this — just sync features
                    } else if (factor > 1.0) {
                        this.setActive(true);
                    } else {
                        this._initialize();
                    }
                } else {
                    if (this._compositorZoomActive) {
                        this._compositorZoomActive = false;
                        this._hideCompositorCrosshairs();
                        this._stopFocusCaretTracking();
                        this.emit('active-changed', false);
                    } else if (this.isActive()) {
                        this.setActive(false);
                    }
                }
            });

        // Export to dbus.
        magDBusService = new MagnifierDBus.CinnamonMagnifier(this.enabled);
        magInputHandler = new MagnifierInputHandler(this);

        let factor = parseFloat(this._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
        if (this.enabled && factor > 1.0)
            this.setActive(true);
    }

    _initialize() {
        if (this._initialized)
            return;

        this._initialized = true;
        // Create small clutter tree for the magnified mouse.
        let cursorTracker = Meta.CursorTracker.get_for_display(global.display);

        this._mouseSprite = new Clutter.Actor({ request_mode: Clutter.RequestMode.CONTENT_SIZE });
        this._mouseSprite.content = new MouseSpriteContent();
        this._cursorTracker = cursorTracker;

        this._updateMouseSprite();

        this._cursorRoot = new Clutter.Actor();
        this._cursorRoot.add_child(this._mouseSprite);

        [this.xMouse, this.yMouse, ] = global.get_pointer();

        cursorTracker.connect('cursor-changed', this._updateMouseSprite.bind(this));

        // Create the first ZoomRegion and initialize it according to the
        // magnification settings.
        let aZoomRegion = new ZoomRegion(this, this._cursorRoot);
        this._zoomRegions.push(aZoomRegion);
        aZoomRegion.scrollContentsTo(this.xMouse, this.yMouse);
        this._settingsInit(aZoomRegion);
    }

    /**
     * showSystemCursor:
     * Show the system mouse pointer.
     */
    showSystemCursor() {
        this._initialize();
        this._cursorTracker.set_pointer_visible(true);
    }

    /**
     * hideSystemCursor:
     * Hide the system mouse pointer.
     */
    hideSystemCursor() {
        this._initialize();
        this._cursorTracker.set_pointer_visible(false);
    }

    _useCompositorZoom() {
        if (!this._zoomBridge.available)
            return false;
        if (!this._settings.get_boolean(COMPOSITOR_ZOOM_ENABLED_KEY))
            return false;
        if (this._zoomRegions.length === 0)
            return true;
        let zr = this._zoomRegions[0];
        return !zr._lensMode &&
               zr._screenPosition === ScreenPosition.FULL_SCREEN;
    }

    /**
     * setActive:
     * Show/hide all the zoom regions.
     * @activate:   Boolean to activate or de-activate the magnifier.
     */
    setActive(activate) {
        if (!activate && !this._initialized)
            return;

    if (activate && this._useCompositorZoom()) {
        if (!this._compositorZoomActive) {
            let factor = parseFloat(this._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
            if (factor <= 1.0)
                factor = 2.0;
            let monitorIndex = this._getPointerMonitorIndex();
            this._zoomBridge.setZoomLevelForMonitor(monitorIndex, factor);
        }
        this._compositorZoomActive = true;
        this._propagateMouseTrackingToCompositor();
        this._propagateColorEffectsToCompositor();
        this._propagateZoomScopeToCompositor();
        this._propagateZoomStepToCompositor();
        this._propagateMinZoomToCompositor();
        this._propagateMaxZoomToCompositor();
        if (this._settings.get_boolean(SHOW_CROSS_HAIRS_KEY))
            this._showCompositorCrosshairs();
        this._startFocusCaretTracking();
        this.emit('active-changed', activate);
        return;
    }

    if (!activate && this._compositorZoomActive) {
        this._zoomBridge.resetZoom();
        this._compositorZoomActive = false;
        this._hideCompositorCrosshairs();
        this._stopFocusCaretTracking();
            this.emit('active-changed', activate);
            return;
        }

        this._initialize();

        this._zoomRegions.forEach ((zoomRegion, index, array) => {
            zoomRegion.setActive(activate);
        });

        if (activate)
            this.startTrackingMouse();
        else
            this.stopTrackingMouse();

        // Make sure system mouse pointer is shown when all zoom regions are
        // invisible.
        if (!activate)
            this._cursorTracker.set_pointer_visible(true);

        // Notify interested parties of this change
        this.emit('active-changed', activate);
    }

    _writeBackMagFactor(factor) {
        this._settings.set_double(MAG_FACTOR_KEY, factor);
        this.updateMagId = 0;
        return false;
    }

    /**
     * setMagFactor:
     * @xMagFactor:     The power to set the horizontal magnification factor to
     *                  of the magnified view.  A value of 1.0 means no
     *                  magnification.  A value of 2.0 doubles the size.
     * @yMagFactor:     The power to set the vertical magnification factor to
     *                  of the magnified view.
     */
    setMagFactor(xMagFactor, yMagFactor) {
        if (this._useCompositorZoom()) {
            let monitorIndex = this._getPointerMonitorIndex();
            this._zoomBridge.setZoomLevelForMonitor(monitorIndex, xMagFactor);
            this._compositorZoomActive = xMagFactor > 1.0;

            if (this.updateMagId > 0) {
                GLib.source_remove (this.updateMagId);
                this.updateMagId = 0;
            }
            this.updateMagId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000,
                this._writeBackMagFactor.bind(this, xMagFactor));
            return;
        }

        this._initialize();

        let zr = this.getZoomRegions()[0];
        zr.setMagFactor(xMagFactor, yMagFactor);

        if (this.updateMagId > 0) {
            GLib.source_remove (this.updateMagId);
            this.updateMagId = 0;
        }
        this.updateMagId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000,
            this._writeBackMagFactor.bind(this, xMagFactor));
    }

    /**
     * isActive:
     * @return  Whether the magnifier is active (boolean).
     */
    isActive() {
        if (this._compositorZoomActive)
            return true;
        // Sufficient to check one ZoomRegion since Magnifier's active
        // state applies to all of them.
        if (this._zoomRegions.length == 0)
            return false;
        else
            return this._zoomRegions[0].isActive();
    }

    /**
     * startTrackingMouse:
     * Turn on mouse tracking, if not already doing so.
     */
    startTrackingMouse() {
        this._initialize();
        if (!this._mouseTrackingId)
            this._mouseTrackingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                MOUSE_POLL_FREQUENCY,
                this.scrollToMousePos.bind(this)
            );
    }

    /**
     * stopTrackingMouse:
     * Turn off mouse tracking, if not already doing so.
     */
    stopTrackingMouse() {
        if (this._mouseTrackingId)
            GLib.source_remove(this._mouseTrackingId);

        this._mouseTrackingId = null;
    }

    /**
     * isTrackingMouse:
     * Is the magnifier tracking the mouse currently?
     */
    isTrackingMouse() {
        return !!this._mouseTrackingId;
    }

    /**
     * scrollToMousePos:
     * Position all zoom regions' ROI relative to the current location of the
     * system pointer.
     * @return      true.
     */
    scrollToMousePos() {
        this._initialize();

        let [xMouse, yMouse, mask] = global.get_pointer();

        if (xMouse != this.xMouse || yMouse != this.yMouse) {
            this.xMouse = xMouse;
            this.yMouse = yMouse;

            let sysMouseOverAny = false;
            this._zoomRegions.forEach((zoomRegion, index, array) => {
                if (zoomRegion.scrollToMousePos())
                    sysMouseOverAny = true;
            });
            if (sysMouseOverAny)
                this.hideSystemCursor();
            else
                this.showSystemCursor();
        }
        return true;
    }

    /**
     * createZoomRegion:
     * Create a ZoomRegion instance with the given properties.
     * @xMagFactor:     The power to set horizontal magnification of the
     *                  ZoomRegion.  A value of 1.0 means no magnification.  A
     *                  value of 2.0 doubles the size.
     * @yMagFactor:     The power to set the vertical magnification of the
     *                  ZoomRegion.
     * @roi             Object in the form { x, y, width, height } that
     *                  defines the region to magnify.  Given in unmagnified
     *                  coordinates.
     * @viewPort        Object in the form { x, y, width, height } that defines
     *                  the position of the ZoomRegion on screen.
     * @return          The newly created ZoomRegion.
     */
    createZoomRegion(xMagFactor, yMagFactor, roi, viewPort) {
        this._initialize();

        let zoomRegion = new ZoomRegion(this, this._cursorRoot);
        zoomRegion.setViewPort(viewPort);

        // We ignore the redundant width/height on the ROI
        let fixedROI = Object.assign({}, roi);
        fixedROI.width = viewPort.width / xMagFactor;
        fixedROI.height = viewPort.height / yMagFactor;
        zoomRegion.setROI(fixedROI);

        zoomRegion.addCrosshairs(this._crossHairs);
        return zoomRegion;
    }

    /**
     * addZoomRegion:
     * Append the given ZoomRegion to the list of currently defined ZoomRegions
     * for this Magnifier instance.
     * @zoomRegion:     The zoomRegion to add.
     */
    addZoomRegion(zoomRegion) {
        this._initialize();

        if(zoomRegion) {
            this._zoomRegions.push(zoomRegion);
            if (!this.isTrackingMouse())
                this.startTrackingMouse();
        }
    }

    /**
     * getZoomRegions:
     * Return a list of ZoomRegion's for this Magnifier.
     * @return:     The Magnifier's zoom region list (array).
     */
    getZoomRegions() {
        return this._zoomRegions;
    }

    /**
     * clearAllZoomRegions:
     * Remove all the zoom regions from this Magnfier's ZoomRegion list.
     */
    clearAllZoomRegions() {
        if (!this._initialized)
            return;

        for (let i = 0; i < this._zoomRegions.length; i++)
            this._zoomRegions[i].setActive(false);

        this._zoomRegions.length = 0;
        this.stopTrackingMouse();
        this.showSystemCursor();
    }

    /**
     * addCrosshairs:
     * Add and show a cross hair centered on the magnified mouse.
     */
    addCrosshairs() {
        this._initialize();

        if (!this._crossHairs)
            this._crossHairs = new Crosshairs();

        let thickness = this._settings.get_int(CROSS_HAIRS_THICKNESS_KEY);
        let color = this._settings.get_string(CROSS_HAIRS_COLOR_KEY);
        let opacity = this._settings.get_double(CROSS_HAIRS_OPACITY_KEY);
        let length = this._settings.get_int(CROSS_HAIRS_LENGTH_KEY);
        let clip = this._settings.get_boolean(CROSS_HAIRS_CLIP_KEY);

        this.setCrosshairsThickness(thickness);
        this.setCrosshairsColor(color);
        this.setCrosshairsOpacity(opacity);
        this.setCrosshairsLength(length);
        this.setCrosshairsClip(clip);

        let theCrossHairs = this._crossHairs;
        this._zoomRegions.forEach ((zoomRegion, index, array) => {
            zoomRegion.addCrosshairs(theCrossHairs);
        });
    }

    /**
     * setCrosshairsVisible:
     * Show or hide the cross hair.
     * @visible    Flag that indicates show (true) or hide (false).
     */
    setCrosshairsVisible(visible) {
        if (visible) {
            if (!this._crossHairs)
                this.addCrosshairs();
            this._crossHairs.show();
            if (this._compositorZoomActive)
                this._showCompositorCrosshairs();
        } else {
            if (this._crossHairs)
                this._crossHairs.hide();
            this._hideCompositorCrosshairs();
        }
    }

    _showCompositorCrosshairs() {
        if (!this._crossHairs)
            return;
        if (!this._compositorCrosshairsClone) {
            this._compositorCrosshairsClone = new Clutter.Clone({
                source: this._crossHairs
            });
            global.stage.add_child(this._compositorCrosshairsClone);
            Cinnamon.util_set_hidden_from_pick(this._compositorCrosshairsClone, true);
        }
        this._compositorCrosshairsClone.show();
        this._updateCompositorCrosshairsPosition();
        if (!this._compositorCrosshairsTrackId) {
            this._compositorCrosshairsTrackId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, MOUSE_POLL_FREQUENCY,
                this._updateCompositorCrosshairsPosition.bind(this));
        }
    }

    _hideCompositorCrosshairs() {
        if (this._compositorCrosshairsTrackId) {
            GLib.source_remove(this._compositorCrosshairsTrackId);
            this._compositorCrosshairsTrackId = 0;
        }
        if (this._compositorCrosshairsClone) {
            this._compositorCrosshairsClone.hide();
        }
    }

    _updateCompositorCrosshairsPosition() {
        if (!this._compositorCrosshairsClone || !this._compositorCrosshairsClone.visible)
            return true;
        let [xMouse, yMouse, ] = global.get_pointer();
        let [w, h] = this._compositorCrosshairsClone.get_size();
        this._compositorCrosshairsClone.set_position(
            xMouse - w / 2, yMouse - h / 2);
        return true;
    }

    _destroyCompositorCrosshairs() {
        if (this._compositorCrosshairsTrackId) {
            GLib.source_remove(this._compositorCrosshairsTrackId);
            this._compositorCrosshairsTrackId = 0;
        }
        if (this._compositorCrosshairsClone) {
            this._compositorCrosshairsClone.destroy();
            this._compositorCrosshairsClone = null;
        }
    }

    /**
     * setCrosshairsColor:
     * Set the color of the crosshairs for all ZoomRegions.
     * @color:  The color as a string, e.g. '#ff0000ff' or 'red'.
     */
    setCrosshairsColor(color) {
        if (this._crossHairs) {
            let [success, cc] = Clutter.Color.from_string(color);
            if (success)
                this._crossHairs.setColor(cc);
        }
    }

    /**
     * getCrosshairsColor:
     * Get the color of the crosshairs.
     * @return: The color as a string, e.g. '#0000ffff' or 'blue'.
     */
    getCrosshairsColor() {
        if (this._crossHairs) {
            let clutterColor = this._crossHairs.getColor();
            return clutterColor.to_string();
        } else {
            return '#00000000';
        }
    }

    /**
     * setCrosshairsThickness:
     * Set the crosshairs thickness for all ZoomRegions.
     * @thickness:  The width of the vertical and horizontal lines of the
     *              crosshairs.
     */
    setCrosshairsThickness(thickness) {
        if (this._crossHairs)
            this._crossHairs.setThickness(thickness);
    }

    /**
     * getCrosshairsThickness:
     * Get the crosshairs thickness.
     * @return: The width of the vertical and horizontal lines of the
     *          crosshairs.
     */
    getCrosshairsThickness() {
        if (this._crossHairs)
            return this._crossHairs.getThickness();
        else
            return 0;
    }

    /**
     * setCrosshairsOpacity:
     * @opacity:    Value between 0.0 (transparent) and 1.0 (fully opaque).
     */
    setCrosshairsOpacity(opacity) {
        if (this._crossHairs)
            this._crossHairs.setOpacity(opacity * 255);
    }

    /**
     * getCrosshairsOpacity:
     * @return:     Value between 0.0 (transparent) and 1.0 (fully opaque).
     */
    getCrosshairsOpacity() {
        if (this._crossHairs)
            return this._crossHairs.getOpacity() / 255.0;
        else
            return 0.0;
    }

    /**
     * setCrosshairsLength:
     * Set the crosshairs length for all ZoomRegions.
     * @length: The length of the vertical and horizontal lines making up the
     *          crosshairs.
     */
    setCrosshairsLength(length) {
        if (this._crossHairs)
            this._crossHairs.setLength(length);
    }

    /**
     * getCrosshairsLength:
     * Get the crosshairs length.
     * @return: The length of the vertical and horizontal lines making up the
     *          crosshairs.
     */
    getCrosshairsLength() {
        if (this._crossHairs)
            return this._crossHairs.getLength();
        else
            return 0;
    }

    /**
     * setCrosshairsClip:
     * Set whether the crosshairs are clipped at their intersection.
     * @clip:   Flag to indicate whether to clip the crosshairs.
     */
    setCrosshairsClip(clip) {
        if (clip) {
            if (this._crossHairs)
                this._crossHairs.setClip(CROSSHAIRS_CLIP_SIZE);
        } else {
            // Setting no clipping on crosshairs means a zero sized clip
            // rectangle.
            if (this._crossHairs)
                this._crossHairs.setClip([0, 0]);
        }
    }

    /**
     * getCrosshairsClip:
     * Get whether the crosshairs are clipped by the mouse image.
     * @return:   Whether the crosshairs are clipped.
     */
    getCrosshairsClip() {
        if (this._crossHairs) {
            let [clipWidth, clipHeight] = this._crossHairs.getClip();
            return (clipWidth > 0 && clipHeight > 0);
        } else {
            return false;
        }
    }

    //// Private methods ////

    _updateMouseSprite() {
        this._mouseSprite.content.texture = this._cursorTracker.get_sprite();
        let [xHot, yHot] = this._cursorTracker.get_hot();
        this._mouseSprite.set_anchor_point(xHot, yHot);
    }

    _updateZoomRegion(zoomRegion) {
        if (zoomRegion._lensMode) {
            let pref = this._settings.get_enum(LENS_SHAPE_KEY);
            zoomRegion.setLensShape(pref);
        } else {
            let pref = this._settings.get_enum(SCREEN_POSITION_KEY);
            zoomRegion.setScreenPosition(pref);
        }
    }

    _settingsInit(zoomRegion) {
        let ret = 1.0;
        if (zoomRegion) {
            // Mag factor is accurate to two decimal places.
            let aPref = parseFloat(this._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
            ret = aPref;
            if (aPref > 1.0)
                zoomRegion.setMagFactor(aPref, aPref);

            zoomRegion.setLensMode(this._settings.get_boolean(LENS_MODE_KEY));
            zoomRegion.setClampScrollingAtEdges(!this._settings.get_boolean(CLAMP_MODE_KEY));

            this._updateZoomRegion(zoomRegion)

            aPref = this._settings.get_enum(MOUSE_TRACKING_KEY);
            if (aPref)
                zoomRegion.setMouseTrackingMode(aPref);
        }

        let showCrosshairs = this._settings.get_boolean(SHOW_CROSS_HAIRS_KEY);
        this.addCrosshairs();
        this.setCrosshairsVisible(showCrosshairs);

        this._settings.connect('changed::' + SCREEN_POSITION_KEY,
                               this._updateScreenPosition.bind(this));
        this._settings.connect('changed::' + LENS_SHAPE_KEY,
                               this._updateLensShape.bind(this));
        this._settings.connect('changed::' + MAG_FACTOR_KEY,
                               this._updateMagFactor.bind(this));
        this._settings.connect('changed::' + LENS_MODE_KEY,
                               this._updateLensShape.bind(this));
        this._settings.connect('changed::' + CLAMP_MODE_KEY,
                               this._updateClampMode.bind(this));
        this._settings.connect('changed::' + MOUSE_TRACKING_KEY,
                               this._updateMouseTrackingMode.bind(this));

        this._settings.connect('changed::' + SHOW_CROSS_HAIRS_KEY, () => {
            this.setCrosshairsVisible(this._settings.get_boolean(SHOW_CROSS_HAIRS_KEY));
        });

        this._settings.connect('changed::' + CROSS_HAIRS_THICKNESS_KEY, () => {
            this.setCrosshairsThickness(this._settings.get_int(CROSS_HAIRS_THICKNESS_KEY));
        });

        this._settings.connect('changed::' + CROSS_HAIRS_COLOR_KEY, () => {
            this.setCrosshairsColor(this._settings.get_string(CROSS_HAIRS_COLOR_KEY));
        });

        this._settings.connect('changed::' + CROSS_HAIRS_OPACITY_KEY, () => {
            this.setCrosshairsOpacity(this._settings.get_double(CROSS_HAIRS_OPACITY_KEY));
        });

        this._settings.connect('changed::' + CROSS_HAIRS_LENGTH_KEY, () => {
            this.setCrosshairsLength(this._settings.get_int(CROSS_HAIRS_LENGTH_KEY));
        });

    this._settings.connect('changed::' + CROSS_HAIRS_CLIP_KEY, () => {
      this.setCrosshairsClip(this._settings.get_boolean(CROSS_HAIRS_CLIP_KEY));
    });

    this._settings.connect('changed::' + INVERT_LIGHTNESS_KEY, () => {
      this._propagateColorEffectsToCompositor();
    });
    this._settings.connect('changed::' + COLOR_SATURATION_KEY, () => {
      this._propagateColorEffectsToCompositor();
    });
    this._settings.connect('changed::' + BRIGHTNESS_RED_KEY, () => {
      this._propagateColorEffectsToCompositor();
    });
    this._settings.connect('changed::' + BRIGHTNESS_GREEN_KEY, () => {
      this._propagateColorEffectsToCompositor();
    });
    this._settings.connect('changed::' + BRIGHTNESS_BLUE_KEY, () => {
      this._propagateColorEffectsToCompositor();
    });
    this._settings.connect('changed::' + CONTRAST_RED_KEY, () => {
      this._propagateColorEffectsToCompositor();
    });
    this._settings.connect('changed::' + CONTRAST_GREEN_KEY, () => {
      this._propagateColorEffectsToCompositor();
    });
    this._settings.connect('changed::' + CONTRAST_BLUE_KEY, () => {
      this._propagateColorEffectsToCompositor();
    });
    this._settings.connect('changed::' + ZOOM_SCOPE_KEY, () => {
      this._propagateZoomScopeToCompositor();
    });
    this._settings.connect('changed::' + ZOOM_STEP_KEY, () => {
      this._propagateZoomStepToCompositor();
    });
    this._settings.connect('changed::' + MIN_ZOOM_KEY, () => {
      this._propagateMinZoomToCompositor();
    });
    this._settings.connect('changed::' + MAX_ZOOM_KEY, () => {
      this._propagateMaxZoomToCompositor();
    });

    this._settings.connect('changed::' + COMPOSITOR_ZOOM_ENABLED_KEY, () => {
      this._updateZoomEngine();
    });

        return ret > 1.0;
    }

    _updateScreenPosition() {
        let position = this._settings.get_enum(SCREEN_POSITION_KEY);
        let wasCompositor = this._compositorZoomActive;
        let nowCompositor = this._useCompositorZoom();

        if (wasCompositor && !nowCompositor) {
            let monitorIndex = this._getPointerMonitorIndex();
            this._zoomBridge.resetZoomForMonitor(monitorIndex);
            this._compositorZoomActive = false;
            this._hideCompositorCrosshairs();
            this._stopFocusCaretTracking();
            this._initialize();
            this._zoomRegions[0].setScreenPosition(position);
            if (this.enabled) {
                let factor = parseFloat(this._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
                this._zoomRegions[0].setMagFactor(factor, factor);
                this._zoomRegions[0].setActive(true);
                this.startTrackingMouse();
            }
        } else if (!wasCompositor && nowCompositor && this.enabled) {
            if (this._zoomRegions.length)
                this._zoomRegions[0].setActive(false);
            this.stopTrackingMouse();
            this.setActive(true);
        } else if (this._zoomRegions.length) {
            this._zoomRegions[0].setScreenPosition(position);
        }

        if (position != ScreenPosition.FULL_SCREEN)
            this._updateLensMode();
    }

    _updateLensShape() {
        // Applies only to the first zoom region.
        if (this._zoomRegions.length) {
            let shape = this._settings.get_enum(LENS_SHAPE_KEY);
            this._zoomRegions[0].setLensShape(shape);
            this._updateLensMode();
        }
    }

    _updateMagFactor() {
        let magFactor = parseFloat(this._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
        if (this._compositorZoomActive) {
            let monitorIndex = this._getPointerMonitorIndex();
            this._zoomBridge.setZoomLevelForMonitor(monitorIndex, magFactor);
            this._compositorZoomActive = magFactor > 1.0;
            if (!this._compositorZoomActive)
                this._zoomBridge.resetZoomForMonitor(monitorIndex);
        } else if (this._zoomRegions.length) {
            this._zoomRegions[0].setMagFactor(magFactor, magFactor);
        }
        this.setActive(this.enabled && magFactor > 1.0);
    }

    _updateLensMode() {
        let wasCompositor = this._compositorZoomActive;
        let nowCompositor = this._useCompositorZoom();

        if (wasCompositor && !nowCompositor) {
            let monitorIndex = this._getPointerMonitorIndex();
            this._zoomBridge.resetZoomForMonitor(monitorIndex);
            this._compositorZoomActive = false;
            this._hideCompositorCrosshairs();
            this._stopFocusCaretTracking();
            this._initialize();
            this._zoomRegions[0].setLensMode(this._settings.get_boolean(LENS_MODE_KEY));
            if (this.enabled) {
                let factor = parseFloat(this._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
                this._zoomRegions[0].setMagFactor(factor, factor);
                this._zoomRegions[0].setActive(true);
                this.startTrackingMouse();
            }
        } else if (!wasCompositor && nowCompositor && this.enabled) {
            if (this._zoomRegions.length)
                this._zoomRegions[0].setActive(false);
            this.stopTrackingMouse();
            this.setActive(true);
        } else if (this._zoomRegions.length) {
            this._zoomRegions[0].setLensMode(this._settings.get_boolean(LENS_MODE_KEY));
        }
    }

    _updateZoomEngine() {
        let wasCompositor = this._compositorZoomActive;
        let nowCompositor = this._useCompositorZoom();

        if (wasCompositor && !nowCompositor) {
            let monitorIndex = this._getPointerMonitorIndex();
            this._zoomBridge.resetZoomForMonitor(monitorIndex);
            this._compositorZoomActive = false;
            this._hideCompositorCrosshairs();
            this._stopFocusCaretTracking();
            this._initialize();
            if (this._zoomRegions.length) {
                this._zoomRegions[0].setScreenPosition(this._settings.get_enum(SCREEN_POSITION_KEY));
                this._zoomRegions[0].setLensMode(this._settings.get_boolean(LENS_MODE_KEY));
            }
            if (this.enabled) {
                let factor = parseFloat(this._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
                this._zoomRegions[0].setMagFactor(factor, factor);
                this._zoomRegions[0].setActive(true);
                this.startTrackingMouse();
            }
        } else if (!wasCompositor && nowCompositor && this.enabled) {
            if (this._zoomRegions.length)
                this._zoomRegions[0].setActive(false);
            this.stopTrackingMouse();
            this.setActive(true);
        }
    }

    _updateClampMode() {
        // Applies only to the first zoom region.
        if (this._zoomRegions.length) {
            this._zoomRegions[0].setClampScrollingAtEdges(
                !this._settings.get_boolean(CLAMP_MODE_KEY)
            );
        }
    }

    _updateMouseTrackingMode() {
        // Applies only to the first zoom region.
        if (this._zoomRegions.length) {
            this._zoomRegions[0].setMouseTrackingMode(
                this._settings.get_enum(MOUSE_TRACKING_KEY)
            );
        }
        this._propagateMouseTrackingToCompositor();
    }

    _propagateMouseTrackingToCompositor() {
        if (!this._zoomBridge.available)
            return;
        let jsMode = this._settings.get_enum(MOUSE_TRACKING_KEY);
        // JS MouseTrackingMode: NONE=0, CENTERED=1, PROPORTIONAL=2, PUSH=3
        // Muffin MetaZoomMouseTrackingMode: CENTERED=0, PROPORTIONAL=1, PUSH=2
        let compositorMode;
        switch (jsMode) {
            case MouseTrackingMode.CENTERED:
                compositorMode = 0;
                break;
            case MouseTrackingMode.PROPORTIONAL:
                compositorMode = 1;
                break;
            case MouseTrackingMode.PUSH:
                compositorMode = 2;
                break;
            default:
                compositorMode = 0;
                break;
        }
        let monitors = Main.layoutManager.monitors;
        for (let i = 0; i < monitors.length; i++) {
      this._zoomBridge.setMouseTrackingForMonitor(i, compositorMode);
    }
  }

  _propagateColorEffectsToCompositor() {
    if (!this._zoomBridge.available)
      return;
    let invertLightness = this._settings.get_boolean(INVERT_LIGHTNESS_KEY);
    let saturation = this._settings.get_double(COLOR_SATURATION_KEY);
    let brightnessRed = this._settings.get_double(BRIGHTNESS_RED_KEY);
    let brightnessGreen = this._settings.get_double(BRIGHTNESS_GREEN_KEY);
    let brightnessBlue = this._settings.get_double(BRIGHTNESS_BLUE_KEY);
    let contrastRed = this._settings.get_double(CONTRAST_RED_KEY);
    let contrastGreen = this._settings.get_double(CONTRAST_GREEN_KEY);
    let contrastBlue = this._settings.get_double(CONTRAST_BLUE_KEY);
    let monitors = Main.layoutManager.monitors;
    for (let i = 0; i < monitors.length; i++) {
      this._zoomBridge.setColorEffectsForMonitor(
        i, invertLightness, saturation,
        brightnessRed, brightnessGreen, brightnessBlue,
        contrastRed, contrastGreen, contrastBlue);
    }
  }

  _propagateZoomScopeToCompositor() {
    if (!this._zoomBridge.available)
      return;
    let scopeStr = this._settings.get_string(ZOOM_SCOPE_KEY);
    let scope;
    switch (scopeStr) {
    case 'desktop':
      scope = 1;
      break;
    case 'titlebar':
      scope = 2;
      break;
    case 'taskbar':
      scope = 3;
      break;
    default:
      scope = 0;
      break;
    }
    let monitors = Main.layoutManager.monitors;
    for (let i = 0; i < monitors.length; i++) {
      this._zoomBridge.setZoomScopeForMonitor(i, scope);
    }
  }

  _propagateZoomStepToCompositor() {
    if (!this._zoomBridge.available)
      return;
    let step = this._settings.get_double(ZOOM_STEP_KEY);
    let monitors = Main.layoutManager.monitors;
    for (let i = 0; i < monitors.length; i++) {
      this._zoomBridge.setZoomStepForMonitor(i, step);
    }
  }

  _propagateMinZoomToCompositor() {
    if (!this._zoomBridge.available)
      return;
    let minZoom = this._settings.get_double(MIN_ZOOM_KEY);
    let monitors = Main.layoutManager.monitors;
    for (let i = 0; i < monitors.length; i++) {
      this._zoomBridge.setMinZoomForMonitor(i, minZoom);
    }
  }

  _propagateMaxZoomToCompositor() {
    if (!this._zoomBridge.available)
      return;
    let maxZoom = this._settings.get_double(MAX_ZOOM_KEY);
    let monitors = Main.layoutManager.monitors;
    for (let i = 0; i < monitors.length; i++) {
      this._zoomBridge.setMaxZoomForMonitor(i, maxZoom);
    }
  }

  _switchToCompositorZoom() {
    if (this._compositorZoomActive || !this._zoomBridge.available)
      return;

    if (this._initialized) {
      this._zoomRegions.forEach(zr => {
        if (zr.isActive()) zr.setActive(false);
      });
      this.stopTrackingMouse();
      if (this._cursorTracker)
        this._cursorTracker.set_pointer_visible(true);
    }

    let factor = parseFloat(this._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
    if (factor <= 1.0)
      factor = 2.0;

    this._compositorZoomActive = true;
    let monitorIndex = this._getPointerMonitorIndex();
    this._zoomBridge.setZoomLevelForMonitor(monitorIndex, factor);
    this._propagateMouseTrackingToCompositor();
    this._propagateColorEffectsToCompositor();
    this._propagateZoomScopeToCompositor();
    this._propagateZoomStepToCompositor();
    this._propagateMinZoomToCompositor();
    this._propagateMaxZoomToCompositor();
    if (this._settings.get_boolean(SHOW_CROSS_HAIRS_KEY))
      this._showCompositorCrosshairs();
    this._startFocusCaretTracking();
  }

  _getPointerMonitorIndex() {
    let [px, py] = global.get_pointer();
    return this._getMonitorAtPoint(px, py);
  }

  _getMonitorAtPoint(x, y) {
    let monitors = Main.layoutManager.monitors;
    for (let i = 0; i < monitors.length; i++) {
      let m = monitors[i];
      if (x >= m.x && x < m.x + m.width &&
          y >= m.y && y < m.y + m.height)
        return i;
    }
    return 0;
  }
};
Signals.addSignalMethods(Magnifier.prototype);

var ZoomRegion = class ZoomRegion {
    constructor(magnifier, mouseSourceActor) {
        this._magnifier = magnifier;

        this._mouseTrackingMode = MouseTrackingMode.NONE;
        this._clampScrollingAtEdges = false;
        this._lensMode = false;
        this._screenPosition = ScreenPosition.FULL_SCREEN;
        this._lensShape = LensShape.NONE;
        this._magView = null;
        this._uiGroupClone = null;
        this._mouseSourceActor = mouseSourceActor;
        this._mouseActor  = null;
        this._crossHairs = null;
        this._crossHairsActor = null;

        this._viewPortX = 0;
        this._viewPortY = 0;
        this._viewPortWidth = global.screen_width;
        this._viewPortHeight = global.screen_height;
        this._xCenter = this._viewPortWidth / 2;
        this._yCenter = this._viewPortHeight / 2;
        this._xMagFactor = 1;
        this._yMagFactor = 1;
        this._followingCursor = false;
    }

    /**
     * setActive:
     * @activate:   Boolean to show/hide the ZoomRegion.
     */
    setActive(activate) {
        if (activate && !this.isActive()) {
            this._createActors();
            if (this._isMouseOverRegion())
                this._magnifier.hideSystemCursor();
            this._updateMagViewGeometry();
            this._updateCloneGeometry();
            this._updateMousePosition();
            global.top_window_group.raise_top();
        } else if (!activate && this.isActive()) {
            global.reparentActor(global.top_window_group, global.stage);
            this._destroyActors();
        }
    }

    /**
     * isActive:
     * @return  Whether this ZoomRegion is active (boolean).
     */
    isActive() {
        return this._magView != null;
    }

    /**
     * setMagFactor:
     * @xMagFactor:     The power to set the horizontal magnification factor to
     *                  of the magnified view.  A value of 1.0 means no
     *                  magnification.  A value of 2.0 doubles the size.
     * @yMagFactor:     The power to set the vertical magnification factor to
     *                  of the magnified view.
     */
    setMagFactor(xMagFactor, yMagFactor) {
        this._changeROI({ xMagFactor: xMagFactor,
                          yMagFactor: yMagFactor,
                          redoCursorTracking: this._followingCursor });
    }

    /**
     * getMagFactor:
     * @return  an array, [xMagFactor, yMagFactor], containing the horizontal
     *          and vertical magnification powers.  A value of 1.0 means no
     *          magnification.  A value of 2.0 means the contents are doubled
     *          in size, and so on.
     */
    getMagFactor() {
        return [this._xMagFactor, this._yMagFactor];
    }

    /**
     * setMouseTrackingMode
     * @mode:     One of the enum MouseTrackingMode values.
     */
    setMouseTrackingMode(mode) {
        if (mode >= MouseTrackingMode.NONE && mode <= MouseTrackingMode.PUSH)
            this._mouseTrackingMode = mode;
    }

    /**
     * getMouseTrackingMode
     * @return:     One of the enum MouseTrackingMode values.
     */
    getMouseTrackingMode() {
        return this._mouseTrackingMode;
    }

    /**
     * setViewPort
     * Sets the position and size of the ZoomRegion on screen.
     * @viewPort:   Object defining the position and size of the view port.
     *              It has members x, y, width, height.  The values are in
     *              stage coordinate space.
     */
    setViewPort(viewPort) {
        this._setViewPort(viewPort);
        this._screenPosition = ScreenPosition.NONE;
    }

    /**
     * setROI
     * Sets the "region of interest" that the ZoomRegion is magnifying.
     * @roi:    Object that defines the region of the screen to magnify.  It
     *          has members x, y, width, height.  The values are in
     *          screen (unmagnified) coordinate space.
     */
    setROI(roi) {
        if (roi.width <= 0 || roi.height <= 0)
            return;

        this._followingCursor = false;
        this._changeROI({ xMagFactor: this._viewPortWidth / roi.width,
                          yMagFactor: this._viewPortHeight / roi.height,
                          xCenter: roi.x + roi.width  / 2,
                          yCenter: roi.y + roi.height / 2 });
    }

    /**
     * getROI:
     * Retrieves the "region of interest" -- the rectangular bounds of that part
     * of the desktop that the magnified view is showing (x, y, width, height).
     * The bounds are given in non-magnified coordinates.
     * @return  an array, [x, y, width, height], representing the bounding
     *          rectangle of what is shown in the magnified view.
     */
    getROI() {
        let roiWidth = this._viewPortWidth / this._xMagFactor;
        let roiHeight = this._viewPortHeight / this._yMagFactor;

        return [this._xCenter - roiWidth / 2,
                this._yCenter - roiHeight / 2,
                roiWidth, roiHeight];
    }

    /**
     * setLensMode:
     * Turn lens mode on/off.  In full screen mode, lens mode does nothing since
     * a lens the size of the screen is pointless.
     * @lensMode:   A boolean to set the sense of lens mode.
     */
    setLensMode(lensMode) {
        this._lensMode = lensMode;
        if (this._lensMode)
            this.setLensShape(this._lensShape);
        else
            this.setScreenPosition(this._screenPosition);
    }

    /**
     * isLensMode:
     * Is lens mode on or off?
     * @return  The lens mode state as a boolean.
     */
    isLensMode() {
        return this._lensMode;
    }

    /**
     * setClampScrollingAtEdges:
     * Stop vs. allow scrolling of the magnified contents when it scroll beyond
     * the edges of the screen.
     * @clamp:   Boolean to turn on/off clamping.
     */
    setClampScrollingAtEdges(clamp) {
        this._clampScrollingAtEdges = clamp;
        if (clamp)
            this._changeROI();
    }

    /**
     * setSquareLens:
     * Magnifier view occupies a square on the screen.
     */
    setSquareLens() {
        let viewPort = {};
        viewPort.x = 0;
        viewPort.y = 0;
        viewPort.height = global.screen_height / 2;
        viewPort.width = global.screen_height / 2; /* Keep it square */
        this._setViewPort(viewPort);
        this._lensShape = LensShape.SQUARE;
    }

    /**
     * setHorizontalLens:
     * Magnifier view occupies the top half of the screen.
     */
    setHorizontalLens() {
        let viewPort = {};
        viewPort.x = 0;
        viewPort.y = 0;
        viewPort.width = global.screen_width;
        viewPort.height = global.screen_height/2;
        this._setViewPort(viewPort);
        this._lensShape = LensShape.HORIZONTAL;
    }

    /**
     * setVerticalLens:
     * Magnifier view occupies the left half of the screen.
     */
    setVerticalLens() {
        let viewPort = {};
        viewPort.x = 0;
        viewPort.y = 0;
        viewPort.width = global.screen_width/2;
        viewPort.height = global.screen_height;
        this._setViewPort(viewPort);
        this._lensShape = LensShape.VERTICAL;
    }

    /**
     * setTopHalf:
     * Magnifier view occupies the top half of the screen.
     */
    setTopHalf() {
        let viewPort = {};
        viewPort.x = 0;
        viewPort.y = 0;
        viewPort.width = global.screen_width;
        viewPort.height = global.screen_height/2;
        this._setViewPort(viewPort);
        this._screenPosition = ScreenPosition.TOP_HALF;
    }

    /**
     * setBottomHalf:
     * Magnifier view occupies the bottom half of the screen.
     */
    setBottomHalf() {
        let viewPort = {};
        viewPort.x = 0;
        viewPort.y = global.screen_height/2;
        viewPort.width = global.screen_width;
        viewPort.height = global.screen_height/2;
        this._setViewPort(viewPort);
        this._screenPosition = ScreenPosition.BOTTOM_HALF;
    }

    /**
     * setLeftHalf:
     * Magnifier view occupies the left half of the screen.
     */
    setLeftHalf() {
        let viewPort = {};
        viewPort.x = 0;
        viewPort.y = 0;
        viewPort.width = global.screen_width/2;
        viewPort.height = global.screen_height;
        this._setViewPort(viewPort);
        this._screenPosition = ScreenPosition.LEFT_HALF;
    }

    /**
     * setRightHalf:
     * Magnifier view occupies the right half of the screen.
     */
    setRightHalf() {
        let viewPort = {};
        viewPort.x = global.screen_width/2;
        viewPort.y = 0;
        viewPort.width = global.screen_width/2;
        viewPort.height = global.screen_height;
        this._setViewPort(viewPort);
        this._screenPosition = ScreenPosition.RIGHT_HALF;
    }

    /**
     * setFullScreenMode:
     * Set the ZoomRegion to full-screen mode.
     * Note:  disallows lens mode.
     */
    setFullScreenMode() {
        let viewPort = {};
        viewPort.x = 0;
        viewPort.y = 0;
        viewPort.width = global.screen_width;
        viewPort.height = global.screen_height;
        this.setViewPort(viewPort);

        this._screenPosition = ScreenPosition.FULL_SCREEN;
    }

    /**
     * setScreenPosition:
     * Positions the zoom region to one of the enumerated positions on the
     * screen.
     * @position:   one of ScreenPosition.FULL_SCREEN, ScreenPosition.TOP_HALF,
     *              ScreenPosition.BOTTOM_HALF,ScreenPosition.LEFT_HALF, or
     *              ScreenPosition.RIGHT_HALF.
     */
    setScreenPosition(position) {
        switch (position) {
            case ScreenPosition.FULL_SCREEN:
                this.setFullScreenMode();
                break;
            case ScreenPosition.TOP_HALF:
                this.setTopHalf();
                break;
            case ScreenPosition.BOTTOM_HALF:
                this.setBottomHalf();
                break;
            case ScreenPosition.LEFT_HALF:
                this.setLeftHalf();
                break;
            case ScreenPosition.RIGHT_HALF:
                this.setRightHalf();
                break;
        }
    }

    /**
     * setLensShape:
     * Sets the shape of the zoom lens
     * @shape:      LensShape.SQUARE, LensShape.HORIZONTAL, LensShape.VERTICAL.
     */
    setLensShape(shape) {
        switch (shape) {
            case LensShape.SQUARE:
                this.setSquareLens();
                break;
            case LensShape.HORIZONTAL:
                this.setHorizontalLens();
                break;
            case LensShape.VERTICAL:
                this.setVerticalLens();
                break;
        }
    }

    /**
     * getScreenPosition:
     * Tell the outside world what the current mode is -- magnifiying the
     * top half, bottom half, etc.
     * @return:  the current mode.
     */
    getScreenPosition() {
        return this._screenPosition;
    }

    /**
     * getLensShape:
     * Get the shape of the zoom lens
     *
     * @return:  the current shape.
     */
    getLensShape() {
        return this._lensShape;
    }

    /**
     * scrollToMousePos:
     * Set the region of interest based on the position of the system pointer.
     * @return:     Whether the system mouse pointer is over the magnified view.
     */
    scrollToMousePos() {
        this._followingCursor = true;
        if (this._mouseTrackingMode != MouseTrackingMode.NONE)
            this._changeROI({ redoCursorTracking: true });
        else
            this._updateMousePosition();

        // Determine whether the system mouse pointer is over this zoom region.
        return this._isMouseOverRegion();
    }

    /**
     * scrollContentsTo:
     * Shift the contents of the magnified view such it is centered on the given
     * coordinate.
     * @x:      The x-coord of the point to center on.
     * @y:      The y-coord of the point to center on.
     */
    scrollContentsTo(x, y) {
        this._followingCursor = false;
        this._changeROI({ xCenter: x,
                          yCenter: y });
    }

    /**
     * addCrosshairs:
     * Add crosshairs centered on the magnified mouse.
     * @crossHairs: Crosshairs instance
     */
    addCrosshairs(crossHairs) {
        this._crossHairs = crossHairs;

        // If the crossHairs is not already within a larger container, add it
        // to this zoom region.  Otherwise, add a clone.
        if (crossHairs && this.isActive()) {
            this._crossHairsActor = crossHairs.addToZoomRegion(this, this._mouseActor);
        }
    }

    //// Private methods ////

    _createActors() {
        global.reparentActor(global.top_window_group, Main.uiGroup);
        // The root actor for the zoom region
        this._magView = new St.Bin({
            style_class: 'magnifier-zoom-region',
            x_fill: true,
            y_fill: true,
        });
        global.stage.add_child(this._magView);

        // hide the magnified region from CLUTTER_PICK_ALL
        Cinnamon.util_set_hidden_from_pick (this._magView, true);

        // Append a group to clip the contents of the magnified view.
        let mainGroup = new Clutter.Actor({ clip_to_allocation: true });
        this._magView.set_child(mainGroup);

        // Add a background for when the magnified uiGroup is scrolled
        // out of view (don't want to see desktop showing through).
        let background = new Clutter.Actor({
            background_color: Main.DEFAULT_BACKGROUND_COLOR,
            width: global.screen_width,
            height: global.screen_height,
        });
        mainGroup.add_child(background);

        // Clone the group that contains all of UI on the screen.  This is the
        // chrome, the windows, etc.
        this._uiGroupClone = new Clutter.Clone({ source: Main.uiGroup });
        mainGroup.add_child(this._uiGroupClone);
        Main.uiGroup.set_size(global.screen_width, global.screen_height);

        // Add either the given mouseSourceActor to the ZoomRegion, or a clone of
        // it.
        if (this._mouseSourceActor.get_parent() != null)
            this._mouseActor = new Clutter.Clone({ source: this._mouseSourceActor });
        else
            this._mouseActor = this._mouseSourceActor;
        mainGroup.add_child(this._mouseActor);

        if (this._crossHairs)
            this._crossHairsActor = this._crossHairs.addToZoomRegion(this, this._mouseActor);
        else
            this._crossHairsActor = null;
    }

    _destroyActors() {
        if (this._mouseActor == this._mouseSourceActor)
            this._mouseActor.get_parent().remove_actor (this._mouseActor);
        if (this._crossHairs)
            this._crossHairs.removeFromParent(this._crossHairsActor);

        this._magView.destroy();
        this._magView = null;
        this._uiGroupClone = null;
        this._mouseActor = null;
        this._crossHairsActor = null;
    }

    _setViewPort(viewPort, fromROIUpdate) {
        // Sets the position of the zoom region on the screen

        let width = Math.round(Math.min(viewPort.width, global.screen_width));
        let height = Math.round(Math.min(viewPort.height, global.screen_height));
        let x = Math.max(viewPort.x, 0);
        let y = Math.max(viewPort.y, 0);

        x = Math.round(Math.min(x, global.screen_width - width));
        y = Math.round(Math.min(y, global.screen_height - height));

        this._viewPortX = x;
        this._viewPortY = y;
        this._viewPortWidth = width;
        this._viewPortHeight = height;

        this._updateMagViewGeometry();

        if (!fromROIUpdate)
            this._changeROI({ redoCursorTracking: this._followingCursor }); // will update mouse

        if (this.isActive() && this._isMouseOverRegion())
            this._magnifier.hideSystemCursor();
    }

    _changeROI(params) {
        // Updates the area we are viewing; the magnification factors
        // and center can be set explicitly, or we can recompute
        // the position based on the mouse cursor position

        params = Params.parse(params, { xMagFactor: this._xMagFactor,
                                        yMagFactor: this._yMagFactor,
                                        xCenter: this._xCenter,
                                        yCenter: this._yCenter,
                                        redoCursorTracking: false });

        if (params.xMagFactor <= 0)
            params.xMagFactor = this._xMagFactor;
        if (params.yMagFactor <= 0)
            params.yMagFactor = this._yMagFactor;

        this._xMagFactor = params.xMagFactor;
        this._yMagFactor = params.yMagFactor;

        if (params.redoCursorTracking &&
            this._mouseTrackingMode != MouseTrackingMode.NONE) {
            // This depends on this.xMagFactor/yMagFactor already being updated
            [params.xCenter, params.yCenter] = this._centerFromMousePosition();
        }

        if (this._clampScrollingAtEdges) {
            let roiWidth = this._viewPortWidth / this._xMagFactor;
            let roiHeight = this._viewPortHeight / this._yMagFactor;

            params.xCenter = Math.min(params.xCenter, global.screen_width - roiWidth / 2);
            params.xCenter = Math.max(params.xCenter, roiWidth / 2);
            params.yCenter = Math.min(params.yCenter, global.screen_height - roiHeight / 2);
            params.yCenter = Math.max(params.yCenter, roiHeight / 2);
        }

        this._xCenter = params.xCenter;
        this._yCenter = params.yCenter;

        // If in lens mode, move the magnified view such that it is centered
        // over the actual mouse. However, in full screen mode, the "lens" is
        // the size of the screen -- pointless to move such a large lens around.
        if (this._lensMode && !this._isFullScreen())
            this._setViewPort({ x: this._xCenter - this._viewPortWidth / 2,
                                y: this._yCenter - this._viewPortHeight / 2,
                                width: this._viewPortWidth,
                                height: this._viewPortHeight }, true);

        this._updateCloneGeometry();
        this._updateMousePosition();
    }

    _isMouseOverRegion() {
        // Return whether the system mouse sprite is over this ZoomRegion.  If the
        // mouse's position is not given, then it is fetched.
        let mouseIsOver = false;
        if (this.isActive()) {
            let xMouse = this._magnifier.xMouse;
            let yMouse = this._magnifier.yMouse;

            mouseIsOver = (
                xMouse >= this._viewPortX && xMouse < (this._viewPortX + this._viewPortWidth) &&
                yMouse >= this._viewPortY && yMouse < (this._viewPortY + this._viewPortHeight)
            );
        }
        return mouseIsOver;
    }

    _isFullScreen() {
        // Does the magnified view occupy the whole screen? Note that this
        // doesn't necessarily imply
        // this._screenPosition = ScreenPosition.FULL_SCREEN;

        if (this._viewPortX != 0 || this._viewPortY != 0)
            return false;
        if (this._viewPortWidth != global.screen_width ||
            this._viewPortHeight != global.screen_height)
            return false;
        return true;
    }

    _centerFromMousePosition() {
        // Determines where the center should be given the current cursor
        // position and mouse tracking mode

        let xMouse = this._magnifier.xMouse;
        let yMouse = this._magnifier.yMouse;

        if (this._mouseTrackingMode == MouseTrackingMode.PROPORTIONAL) {
            return this._centerFromMouseProportional(xMouse, yMouse);
        }
        else if (this._mouseTrackingMode == MouseTrackingMode.PUSH) {
            return this._centerFromMousePush(xMouse, yMouse);
        }
        else if (this._mouseTrackingMode == MouseTrackingMode.CENTERED) {
            return this._centerFromMouseCentered(xMouse, yMouse);
        }

        return null; // Should never be hit
    }

    _centerFromMousePush(xMouse, yMouse) {
        let [xRoi, yRoi, widthRoi, heightRoi] = this.getROI();
        let [cursorWidth, cursorHeight] = this._mouseSourceActor.get_size();
        let xPos = xRoi + widthRoi / 2;
        let yPos = yRoi + heightRoi / 2;
        let xRoiRight = xRoi + widthRoi - cursorWidth;
        let yRoiBottom = yRoi + heightRoi - cursorHeight;

        if (xMouse < xRoi)
            xPos -= (xRoi - xMouse);
        else if (xMouse > xRoiRight)
            xPos += (xMouse - xRoiRight);

        if (yMouse < yRoi)
            yPos -= (yRoi - yMouse);
        else if (yMouse > yRoiBottom)
            yPos += (yMouse - yRoiBottom);

        return [xPos, yPos];
    }

    _centerFromMouseProportional(xMouse, yMouse) {
        let [xRoi, yRoi, widthRoi, heightRoi] = this.getROI();
        let halfScreenWidth = global.screen_width / 2;
        let halfScreenHeight = global.screen_height / 2;
        // We want to pad with a constant distance after zooming, so divide
        // by the magnification factor.
        let unscaledPadding = Math.min(this._viewPortWidth, this._viewPortHeight) / 5;
        let xPadding = unscaledPadding / this._xMagFactor;
        let yPadding = unscaledPadding / this._yMagFactor;
        let xProportion = (xMouse - halfScreenWidth) / halfScreenWidth;   // -1 ... 1
        let yProportion = (yMouse - halfScreenHeight) / halfScreenHeight; // -1 ... 1
        let xPos = xMouse - xProportion * (widthRoi / 2 - xPadding);
        let yPos = yMouse - yProportion * (heightRoi /2 - yPadding);

        return [xPos, yPos];
    }

    _centerFromMouseCentered(xMouse, yMouse) {
        return [xMouse, yMouse];
    }

    _screenToViewPort(screenX, screenY) {
        // Converts coordinates relative to the (unmagnified) screen to coordinates
        // relative to the origin of this._magView
        return [this._viewPortWidth / 2 + (screenX - this._xCenter) * this._xMagFactor,
                this._viewPortHeight / 2 + (screenY - this._yCenter) * this._yMagFactor];
    }

    _updateMagViewGeometry() {
        if (!this.isActive())
            return;

        if (this._isFullScreen())
            this._magView.add_style_class_name('full-screen');
        else
            this._magView.remove_style_class_name('full-screen');

        this._magView.set_size(this._viewPortWidth, this._viewPortHeight);
        this._magView.set_position(this._viewPortX, this._viewPortY);
    }

    _updateCloneGeometry() {
        if (!this.isActive())
            return;

        this._uiGroupClone.set_scale(this._xMagFactor, this._yMagFactor);
        this._mouseActor.set_scale(this._xMagFactor, this._yMagFactor);

        let [x, y] = this._screenToViewPort(0, 0);
        this._uiGroupClone.set_position(x, y);

        this._updateMousePosition();
    }

    _updateMousePosition() {
        if (!this.isActive())
            return;

        let [xMagMouse, yMagMouse] = this._screenToViewPort(this._magnifier.xMouse,
                                                            this._magnifier.yMouse);

        xMagMouse = Math.round(xMagMouse);
        yMagMouse = Math.round(yMagMouse);

        this._mouseActor.set_position(xMagMouse, yMagMouse);

        if (this._crossHairsActor) {
            let [groupWidth, groupHeight] = this._crossHairsActor.get_size();
            this._crossHairsActor.set_position(xMagMouse - groupWidth / 2,
                                               yMagMouse - groupHeight / 2);
        }
    }
};

var Crosshairs = GObject.registerClass(
class Crosshairs extends Clutter.Actor {
    _init() {
        // Set the group containing the crosshairs to three times the desktop
        // size in case the crosshairs need to appear to be infinite in
        // length (i.e., extend beyond the edges of the view they appear in).
        let groupWidth = global.screen_width * 3;
        let groupHeight = global.screen_height * 3;

        super._init({
            clip_to_allocation: false,
            width: groupWidth,
            height: groupHeight,
        });
        this._horizLeftHair = new Clutter.Actor();
        this._horizRightHair = new Clutter.Actor();
        this._vertTopHair = new Clutter.Actor();
        this._vertBottomHair = new Clutter.Actor();
        this.add_child(this._horizLeftHair);
        this.add_child(this._horizRightHair);
        this.add_child(this._vertTopHair);
        this.add_child(this._vertBottomHair);
        this._clipSize = [0, 0];
        this._clones = [];
        this.reCenter();
    }

    _startFocusCaretTracking() {
        if (this._focusCaretTrackingActive || !Atspi)
            return;
        this._focusCaretTrackingActive = true;
        try {
            Atspi.init();
        } catch (e) {
            log('Magnifier: Atspi.init() failed: ' + e.message);
            this._focusCaretTrackingActive = false;
            return;
        }
        this._focusListenerId = Atspi.EventListener.new(
            this._onAtspiFocus.bind(this));
        this._focusListenerId.register('focus');
        this._focusListenerId.register('object:state-changed:focused');

        this._caretListenerId = Atspi.EventListener.new(
            this._onAtspiCaret.bind(this));
        this._caretListenerId.register('object:text-caret-moved');
    }

    _stopFocusCaretTracking() {
        if (!this._focusCaretTrackingActive)
            return;
        if (this._focusListenerId) {
            this._focusListenerId.deregister('focus');
            this._focusListenerId.deregister('object:state-changed:focused');
            this._focusListenerId = 0;
        }
        if (this._caretListenerId) {
            this._caretListenerId.deregister('object:text-caret-moved');
            this._caretListenerId = 0;
        }
        this._focusCaretTrackingActive = false;
    }

    _onAtspiFocus(event) {
        if (!this._compositorZoomActive)
            return;
        let accessible = event.source;
        if (!accessible)
            return;
        try {
            let [x, y, width, height] = accessible.get_extents(Atspi.CoordType.SCREEN);
            if (width <= 0 || height <= 0)
                return;
            let centerX = x + width / 2;
            let centerY = y + height / 2;
            this._centerCompositorViewportOn(centerX, centerY);
        } catch (e) {
        }
    }

    _onAtspiCaret(event) {
        if (!this._compositorZoomActive)
            return;
        let accessible = event.source;
        if (!accessible)
            return;
        try {
            let [x, y, width, height] = accessible.get_extents(Atspi.CoordType.SCREEN);
            if (width <= 0 || height <= 0)
                return;
            let textIface = accessible.queryText();
            if (textIface) {
                let offset = event.detail1;
                let [cx, cy] = textIface.getCharacterExtents(offset, Atspi.CoordType.SCREEN);
                if (cx >= 0 && cy >= 0) {
                    this._centerCompositorViewportOn(cx, cy);
                    return;
                }
            }
            this._centerCompositorViewportOn(x + width / 2, y + height / 2);
        } catch (e) {
        }
    }

    _centerCompositorViewportOn(screenX, screenY) {
        let monitorIndex = this._getMonitorAtPoint(screenX, screenY);
        if (monitorIndex < 0)
            return;
        let monitors = Main.layoutManager.monitors;
        let monitor = monitors[monitorIndex];
        let localX = screenX - monitor.x;
        let localY = screenY - monitor.y;
        this._zoomBridge.setViewportForMonitor(monitorIndex, localX, localY);
    }

    _getPointerMonitorIndex() {
        let [px, py] = global.get_pointer();
        return this._getMonitorAtPoint(px, py);
    }

    _getMonitorAtPoint(x, y) {
        let monitors = Main.layoutManager.monitors;
        for (let i = 0; i < monitors.length; i++) {
            let m = monitors[i];
            if (x >= m.x && x < m.x + m.width &&
                y >= m.y && y < m.y + m.height)
                return i;
        }
        return 0;
    }

    /**
    * addToZoomRegion
    * Either add the crosshairs actor to the given ZoomRegion, or, if it is
    * already part of some other ZoomRegion, create a clone of the crosshairs
    * actor, and add the clone instead.  Returns either the original or the
    * clone.
    * @zoomRegion:      The container to add the crosshairs group to.
    * @magnifiedMouse:  The mouse actor for the zoom region -- used to
    *                   position the crosshairs and properly layer them below
    *                   the mouse.
    * @return           The crosshairs actor, or its clone.
    */
    addToZoomRegion(zoomRegion, magnifiedMouse) {
        let crosshairsActor = null;
        if (zoomRegion && magnifiedMouse) {
            let container = magnifiedMouse.get_parent();
            if (container) {
                crosshairsActor = this;
                if (this.get_parent() != null) {
                    crosshairsActor = new Clutter.Clone({ source: this });
                    this._clones.push(crosshairsActor);

                    this.bind_property('visible',
                    crosshairsActor, 'visible',
                    GObject.BindingFlags.SYNC_CREATE);
                }

                container.add_child(crosshairsActor);
                container.set_child_above_sibling(magnifiedMouse, crosshairsActor);
                let [xMouse, yMouse] = magnifiedMouse.get_position();
                let [crosshairsWidth, crosshairsHeight] = crosshairsActor.get_size();
                crosshairsActor.set_position(xMouse - crosshairsWidth / 2 , yMouse - crosshairsHeight / 2);
            }
        }
        return crosshairsActor;
    }

    /**
     * removeFromParent:
     * @childActor: the actor returned from addToZoomRegion
     * Remove the crosshairs actor from its parent container, or destroy the
     * child actor if it was just a clone of the crosshairs actor.
     */
    removeFromParent(childActor) {
        if (childActor == this)
            childActor.get_parent().remove_actor(childActor);
        else
            childActor.destroy();
    }

    /**
     * setColor:
     * Set the color of the crosshairs.
     * @clutterColor:   The color as a Clutter.Color.
     */
    setColor(clutterColor) {
        this._horizLeftHair.background_color = clutterColor;
        this._horizRightHair.background_color = clutterColor;
        this._vertTopHair.background_color = clutterColor;
        this._vertBottomHair.background_color = clutterColor;
    }

    /**
     * getColor:
     * Get the color of the crosshairs.
     * @color:  The color as a Clutter.Color.
     */
    getColor() {
        let clutterColor = new Clutter.Color();
        this._horizLeftHair.get_color(clutterColor);
        return clutterColor;
    }

    /**
     * setThickness:
     * Set the width of the vertical and horizontal lines of the crosshairs.
     * @thickness
     */
    setThickness(thickness) {
        this._horizLeftHair.set_height(thickness);
        this._horizRightHair.set_height(thickness);
        this._vertTopHair.set_width(thickness);
        this._vertBottomHair.set_width(thickness);
        this.reCenter();
    }

    /**
     * getThickness:
     * Get the width of the vertical and horizontal lines of the crosshairs.
     * @return:     The thickness of the crosshairs.
     */
    getThickness() {
        return this._horizLeftHair.get_height();
    }

    /**
     * setOpacity:
     * Set how opaque the crosshairs are.
     * @opacity:    Value between 0 (fully transparent) and 255 (full opaque).
     */
    setOpacity(opacity) {
        // set_opacity() throws an exception for values outside the range
        // [0, 255].
        if (opacity < 0)
            opacity = 0;
        else if (opacity > 255)
            opacity = 255;

        this._horizLeftHair.set_opacity(opacity);
        this._horizRightHair.set_opacity(opacity);
        this._vertTopHair.set_opacity(opacity);
        this._vertBottomHair.set_opacity(opacity);
    }

    /**
     * getOpacity:
     * Retrieve how opaque the crosshairs are.
     * @return: A value between 0 (transparent) and 255 (opaque).
     */
    getOpacity() {
        return this._horizLeftHair.get_opacity();
    }

    /**
     * setLength:
     * Set the length of the vertical and horizontal lines in the crosshairs.
     * @length: The length of the crosshairs.
     */
    setLength(length) {
        this._horizLeftHair.set_width(length);
        this._horizRightHair.set_width(length);
        this._vertTopHair.set_height(length);
        this._vertBottomHair.set_height(length);
        this.reCenter();
    }

    /**
     * getLength:
     * Get the length of the vertical and horizontal lines in the crosshairs.
     * @return: The length of the crosshairs.
     */
    getLength() {
        return this._horizLeftHair.get_width();
    }

    /**
     * setClip:
     * Set the width and height of the rectangle that clips the crosshairs at
     * their intersection
     * @size:   Array of [width, height] defining the size of the clip
     *          rectangle.
     */
    setClip(size) {
        if (size) {
            // Take a chunk out of the crosshairs where it intersects the
            // mouse.
            this._clipSize = size;
            this.reCenter();
        }
        else {
            // Restore the missing chunk.
            this._clipSize = [0, 0];
            this.reCenter();
        }
     }

    /**
     * getClip:
     * Get the dimensions of the clip rectangle.
     * @return:   An array of the form [width, height].
     */
    getClip() {
        return this._clipSize;
    }

    /**
     * reCenter:
     * Reposition the horizontal and vertical hairs such that they cross at
     * the center of crosshairs group.  If called with the dimensions of
     * the clip rectangle, these are used to update the size of the clip.
     * @clipSize:  Optional.  If present, an array of the form [width, height].
     */
    reCenter(clipSize) {
        let [groupWidth, groupHeight] = this.get_size();
        let leftLength = this._horizLeftHair.get_width();
        let rightLength = this._horizRightHair.get_width();
        let topLength = this._vertTopHair.get_height();
        let bottomLength = this._vertBottomHair.get_height();
        let thickness = this._horizLeftHair.get_height();

        // Deal with clip rectangle.
        if (clipSize)
            this._clipSize = clipSize;
        let clipWidth = this._clipSize[0];
        let clipHeight = this._clipSize[1];

        // Note that clip, if present, is not centred on the cross hair
        // intersection, but biased towards the top left.
        let left = groupWidth / 2 - clipWidth * 0.25 - leftLength;
        let right = groupWidth / 2 + clipWidth * 0.75;
        let top = groupHeight / 2 - clipHeight * 0.25 - topLength - thickness / 2;
        let bottom = groupHeight / 2 + clipHeight * 0.75 + thickness / 2;
        this._horizLeftHair.set_position(left, (groupHeight - thickness) / 2);
        this._horizRightHair.set_position(right, (groupHeight - thickness) / 2);
        this._vertTopHair.set_position((groupWidth - thickness) / 2, top);
        this._vertBottomHair.set_position((groupWidth - thickness) / 2, bottom);
    }
});

const INCR = 0.1;
const MAX_ZOOM = 15.0; /* from range of org.cinnamon.desktop.a11y.magnifier mag-factor key */

var MagnifierInputHandler = class MagnifierInputHandler {
    constructor(magnifier) {
        this.magnifier = magnifier;

        this._zoomInId = 0;
        this._zoomOutId = 0;
        this._zoomEnabled = false;

        this._a11ySettings = new Gio.Settings({ schema_id: APPLICATIONS_SCHEMA });
        this._a11ySettings.connect("changed::" + SHOW_KEY, this._refreshState.bind(this));

        this.keybindingSettings = new Gio.Settings({ schema_id: KEYBINDING_SCHEMA });
        this.keybindingSettings.connect("changed", this._refreshState.bind(this));

        this._refreshState();
    }

    _enableZoom() {
        if (this._zoomInId > 0 || this._zoomOutId > 0)
            this._disableZoom();
        this._zoomInId = global.display.connect('zoom-scroll-in', this._onZoomScrollIn.bind(this));
        this._zoomOutId = global.display.connect('zoom-scroll-out', this._onZoomScrollOut.bind(this));
        this._zoomEnabled = true;
    }

    _disableZoom() {
        if (this._zoomInId > 0)
            global.display.disconnect(this._zoomInId)
        if (this._zoomOutId > 0)
            global.display.disconnect(this._zoomOutId);

        this._zoomInId = 0;
        this._zoomOutId = 0;

    Main.keybindingManager.removeHotKey("magnifier-zoom-in");
    Main.keybindingManager.removeHotKey("magnifier-zoom-out");
    Main.keybindingManager.removeHotKey("magnifier-zoom-reset");
    Main.keybindingManager.removeHotKey("magnifier-toggle-zoom");
    Main.keybindingManager.removeHotKey("magnifier-zoom-previous");
    Main.keybindingManager.removeHotKey("magnifier-zoom-mode-fullscreen");
    Main.keybindingManager.removeHotKey("magnifier-zoom-mode-lens");
    Main.keybindingManager.removeHotKey("magnifier-zoom-mode-top-half");
    Main.keybindingManager.removeHotKey("magnifier-zoom-mode-bottom-half");
    Main.keybindingManager.removeHotKey("magnifier-zoom-mode-left-half");
    Main.keybindingManager.removeHotKey("magnifier-zoom-mode-right-half");
    Main.keybindingManager.removeHotKey("magnifier-zoom-on-titlebar");
    Main.keybindingManager.removeHotKey("magnifier-zoom-on-fullscreen");
    Main.keybindingManager.removeHotKey("magnifier-zoom-increase-step");
    Main.keybindingManager.removeHotKey("magnifier-zoom-decrease-step");
    Main.keybindingManager.removeHotKey("magnifier-zoom-reset-step");

        this._zoomEnabled = false;
    }

  _setupKeybindings() {
    let kb = this.keybindingSettings.get_strv(ZOOM_IN_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-in", kb, this._zoomIn.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_OUT_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-out", kb, this._zoomOut.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_RESET_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-reset", kb, this._zoomReset.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_TOGGLE_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-toggle-zoom", kb, this._toggleZoom.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_PREVIOUS_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-previous", kb, this._zoomPrevious.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_MODE_FULLSCREEN_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-mode-fullscreen", kb, this._setZoomModeFullscreen.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_MODE_LENS_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-mode-lens", kb, this._setZoomModeLens.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_MODE_TOP_HALF_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-mode-top-half", kb, this._setZoomModeTopHalf.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_MODE_BOTTOM_HALF_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-mode-bottom-half", kb, this._setZoomModeBottomHalf.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_MODE_LEFT_HALF_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-mode-left-half", kb, this._setZoomModeLeftHalf.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_MODE_RIGHT_HALF_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-mode-right-half", kb, this._setZoomModeRightHalf.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_ON_TITLEBAR_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-on-titlebar", kb, this._toggleZoomOnTitlebar.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_ON_FULLSCREEN_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-on-fullscreen", kb, this._toggleZoomOnFullscreen.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_INCREASE_STEP_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-increase-step", kb, this._increaseStep.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_DECREASE_STEP_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-decrease-step", kb, this._decreaseStep.bind(this));
    kb = this.keybindingSettings.get_strv(ZOOM_RESET_STEP_KEY);
    Main.keybindingManager.addHotKeyArray("magnifier-zoom-reset-step", kb, this._resetStep.bind(this));
  }

    _refreshState() {
        this.zoomActive = this.magnifier.isActive();
        this.currentZoom = 1.0;

        if (this.zoomActive) {
            if (this.magnifier._compositorZoomActive) {
                // Compositor zoom doesn't expose sync zoom level yet;
                // read from settings as approximation
                this.currentZoom = parseFloat(
                    this.magnifier._settings.get_double(MAG_FACTOR_KEY).toFixed(2));
            } else if (this.magnifier.getZoomRegions().length > 0) {
                this.currentZoom = this.magnifier.getZoomRegions()[0].getMagFactor()[0];
            }
        }

        let shouldEnable = this._a11ySettings.get_boolean(SHOW_KEY);

        if (shouldEnable && !this._zoomEnabled) {
            this._enableZoom();
        } else if (!shouldEnable && this._zoomEnabled) {
            this._disableZoom();
        }

        if (this._zoomEnabled) {
            this._setupKeybindings();
    }
  }

  _checkZoomScope() {
    let scopeStr = this.magnifier._settings.get_string(ZOOM_SCOPE_KEY);
    if (scopeStr === 'anywhere')
      return true;

    let [px, py] = global.get_pointer();

    if (scopeStr === 'desktop') {
      if (this._isPointerOverPanel(px, py) || this._isPointerOverPopupMenu(px, py))
        return false;
      return true;
    }

    if (scopeStr === 'titlebar') {
      return this._isPointerOverTitlebar(px, py);
    }

    if (scopeStr === 'taskbar') {
      return this._isPointerOverPanel(px, py);
    }

    return true;
  }

  _isPointerOverPanel(px, py) {
    if (!Main.panelManager)
      return false;
    let panels = Main.panelManager.getPanels();
    if (!panels)
      return false;
    for (let i = 0; i < panels.length; i++) {
      let panel = panels[i];
      if (!panel.actor || !panel.actor.mapped)
        continue;
      let [ok, x, y] = panel.actor.transform_point(0, 0);
      let w = panel.actor.get_width();
      let h = panel.actor.get_height();
      if (px >= x && px < x + w && py >= y && py < y + h)
        return true;
    }
    return false;
  }

  _isPointerOverPopupMenu(px, py) {
    if (!global.menuStack || global.menuStack.length === 0)
      return false;
    for (let i = 0; i < global.menuStack.length; i++) {
      let menu = global.menuStack[i];
      if (!menu.actor || !menu.actor.mapped)
        continue;
      let [ok, x, y] = menu.actor.transform_point(0, 0);
      let w = menu.actor.get_width();
      let h = menu.actor.get_height();
      if (px >= x && px < x + w && py >= y && py < y + h)
        return true;
    }
    return false;
  }

  _isPointerOverTitlebar(px, py) {
    let windows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
    if (!windows)
      return false;
    for (let i = 0; i < windows.length; i++) {
      let win = windows[i];
      let rect = win.get_frame_rect();
      if (!rect)
        continue;
      if (px < rect.x || px >= rect.x + rect.width)
        continue;
      if (py < rect.y || py >= rect.y + rect.height)
        continue;
      let client_rect = win.get_client_rect();
      if (client_rect && py < client_rect.y)
        return true;
    }
    return false;
  }

  _onZoomScrollIn() {
    if (!this._checkZoomScope()) return;
    this.magnifier._zoomBridge.getZoomLevelForMonitor(
      this._getPointerMonitorIndex(),
      (level, error) => {
        if (!error) this.currentZoom = level;
        this.zoomActive = this.currentZoom > 1.0;
      });
  }

  _onZoomScrollOut() {
    if (!this._checkZoomScope()) return;
    this.magnifier._zoomBridge.getZoomLevelForMonitor(
      this._getPointerMonitorIndex(),
      (level, error) => {
        if (!error) this.currentZoom = level;
        this.zoomActive = this.currentZoom > 1.0;
      });
  }

  _zoomIn(display, screen, event, kb, action) {
    if (!this._checkZoomScope()) return;
    if (this.zoomActive) {
            this.currentZoom = Math.min(this.currentZoom * (1.0 + INCR), MAX_ZOOM);
        } else {
            this.currentZoom *= Math.min(this.currentZoom * (1.0 + INCR), MAX_ZOOM);
            this.magnifier.setActive(true)
            this.zoomActive = true;
        }
        try {
            this.magnifier.setMagFactor(this.currentZoom, this.currentZoom)
        } catch (e) {
            this._refreshState();
        }
    }

  _zoomOut(display, screen, event, kb, action) {
    if (!this._checkZoomScope()) return;
    if (this.zoomActive) {
            this.currentZoom *= (1.0 - INCR);
            if (this.currentZoom <= 1.0) {
                this.currentZoom = 1.0;
                this.magnifier.setActive(false);
                this.zoomActive = false;
            }
            try {
                this.magnifier.setMagFactor(this.currentZoom, this.currentZoom)
            } catch (e) {
                this._refreshState();
            }
        }
    }

  _zoomReset(display, screen, event, kb, action) {
    if (this.zoomActive) {
      this.currentZoom = 1.0
      this.magnifier.setActive(false);
      this.zoomActive = false;

      try {
        this.magnifier.setMagFactor(this.currentZoom, this.currentZoom)
      } catch (e) {
        this._refreshState();
      }
    }
  }

  _getPointerMonitorIndex() {
    let [px, py] = global.get_pointer();
    let monitors = Main.layoutManager.monitors;
    for (let i = 0; i < monitors.length; i++) {
      let m = monitors[i];
      if (px >= m.x && px < m.x + m.width &&
          py >= m.y && py < m.y + m.height)
        return i;
    }
    return 0;
  }

  _toggleZoom() {
    let monitorIndex = this._getPointerMonitorIndex();
    if (this.zoomActive) {
      this.currentZoom = 1.0;
      this.magnifier.setActive(false);
      this.zoomActive = false;
      try {
        this.magnifier.setMagFactor(this.currentZoom, this.currentZoom);
      } catch (e) {
        this._refreshState();
      }
    } else {
      this.currentZoom = this.magnifier._settings.get_double(MAG_FACTOR_KEY);
      this.magnifier.setActive(true);
      this.zoomActive = true;
      try {
        this.magnifier.setMagFactor(this.currentZoom, this.currentZoom);
      } catch (e) {
        this._refreshState();
      }
    }
  }

  _zoomPrevious() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.previousZoomForMonitor(monitorIndex);
  }

  _setZoomModeFullscreen() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.setZoomModeForMonitor(monitorIndex, ZoomBridge.ZoomMode.FULLSCREEN);
  }

  _setZoomModeLens() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.setZoomModeForMonitor(monitorIndex, ZoomBridge.ZoomMode.LENS);
  }

  _setZoomModeTopHalf() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.setZoomModeForMonitor(monitorIndex, ZoomBridge.ZoomMode.TOP_HALF);
  }

  _setZoomModeBottomHalf() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.setZoomModeForMonitor(monitorIndex, ZoomBridge.ZoomMode.BOTTOM_HALF);
  }

  _setZoomModeLeftHalf() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.setZoomModeForMonitor(monitorIndex, ZoomBridge.ZoomMode.LEFT_HALF);
  }

  _setZoomModeRightHalf() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.setZoomModeForMonitor(monitorIndex, ZoomBridge.ZoomMode.RIGHT_HALF);
  }

  _toggleZoomOnTitlebar() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.getZoomScopeForMonitor(monitorIndex, (scope, error) => {
      if (error) return;
      let newScope = (scope === ZoomBridge.ZoomScope.TITLEBAR)
        ? ZoomBridge.ZoomScope.ANYWHERE
        : ZoomBridge.ZoomScope.TITLEBAR;
      this.magnifier._zoomBridge.setZoomScopeForMonitor(monitorIndex, newScope);
      this.magnifier._settings.set_string(ZOOM_SCOPE_KEY,
        newScope === ZoomBridge.ZoomScope.TITLEBAR ? 'titlebar' : 'anywhere');
    });
  }

  _toggleZoomOnFullscreen() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.getZoomModeForMonitor(monitorIndex, (mode, error) => {
      if (error) return;
      let newMode = (mode === ZoomBridge.ZoomMode.FULLSCREEN)
        ? ZoomBridge.ZoomMode.LENS
        : ZoomBridge.ZoomMode.FULLSCREEN;
      this.magnifier._zoomBridge.setZoomModeForMonitor(monitorIndex, newMode);
    });
  }

  _increaseStep() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.increaseStepForMonitor(monitorIndex);
  }

  _decreaseStep() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.decreaseStepForMonitor(monitorIndex);
  }

  _resetStep() {
    if (!this.magnifier._zoomBridge.available) return;
    let monitorIndex = this._getPointerMonitorIndex();
    this.magnifier._zoomBridge.resetStepForMonitor(monitorIndex);
  }
};
