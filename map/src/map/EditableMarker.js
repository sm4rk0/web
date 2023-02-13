import L from "leaflet";
import MarkerOptions from "./markers/MarkerOptions";
import TrackLayerProvider from "./TrackLayerProvider";
import _ from "lodash";
import TracksManager from "../context/TracksManager";
import PointManager from "../context/PointManager";

export default class EditableMarker {

    constructor(map, ctx, point, layer) {
        this.map = map;
        this.ctx = ctx;
        this.point = point;
        this.layer = layer;
    }

    create() {
        let marker = this.layer;
        let options;
        let point;
        if (marker) {
            point = marker.getLatLng();
            options = marker.options;
        } else if (this.point) {
            point = new L.LatLng(this.point.lat, this.point.lng);
        }
        if (point) {
            marker = new L.Marker(point, {
                icon: MarkerOptions.options.route,
                draggable: true,
                contextmenu: true,
                contextmenuInheritItems: false,
                contextmenuItems: [{
                    text: 'Delete point',
                    callback: (e) => {
                        this.delete(e)
                    }
                }],
                ...options
            })
        }

        if (marker) {
            marker.on('dragstart', (e) => {
                this.dragStartPoint(e);
            });
            marker.on('dragend', (e) => {
                this.dragEndPoint(e, this.ctx.setGpxLoading).then(() => {
                    this.ctx.setGpxLoading(false)
                })
            });
        }
        return marker;
    }

    delete(e) {
        let coord = e.relatedTarget._latlng;
        let ind = this.ctx.selectedGpxFile.points.findIndex(point => point.lat === coord.lat && point.lng === coord.lng);
        if (ind !== -1) {
            PointManager.deletePoint(ind, this.ctx).then();
        } else {
            this.deleteWpt(coord);
        }
    }

    deleteWpt(coord) {
        let ind = this.ctx.selectedGpxFile.wpts.findIndex(point => point.lat === coord.lat && point.lon === coord.lng);
        if (ind !== -1) {
            PointManager.deleteWpt(ind, this.ctx);
        }
    }

    dragStartPoint(e) {
        let lat = e.target._latlng.lat;
        let lng = e.target._latlng.lng;
        let indPoint = this.ctx.selectedGpxFile.points.findIndex(point => point.lat === lat && point.lng === lng);
        if (indPoint !== -1) {
            this.ctx.selectedGpxFile.dragPoint = {
                indPoint: indPoint,
                lat: lat,
                lng: lng
            };
        } else {
            let indWpt = this.ctx.selectedGpxFile.wpts.findIndex(point => {
                return point.lat === lat && point.lon === lng
            });
            if (indWpt !== -1) {
                this.ctx.selectedGpxFile.dragPoint = {
                    indWpt: indWpt,
                    lat: lat,
                    lng: lng
                };
            }
        }
        if (this.ctx.selectedGpxFile.dragPoint) {
            this.ctx.selectedGpxFile.addPoint = false;
            this.ctx.setSelectedGpxFile({...this.ctx.selectedGpxFile});
        }
    }

    async dragEndPoint(e, setLoading) {
        setLoading(true);
        let lat = e.target._latlng.lat;
        let lng = e.target._latlng.lng;

        let trackPoints = this.ctx.selectedGpxFile.points;
        let indPoint = this.ctx.selectedGpxFile.dragPoint.indPoint;
        if (indPoint && indPoint !== -1) {
            let currentPoint = trackPoints[indPoint];
            let layers = this.ctx.selectedGpxFile.layers.getLayers();
            let polylines = TrackLayerProvider.getPolylines(layers);

            let currentPolyline;
            let indPointInPolyline;

            polylines.forEach(p => {
                let pp = p._latlngs;
                let fp = pp.find(point => point.lat === currentPoint.lat && point.lng === currentPoint.lng)
                if (fp) {
                    currentPolyline = p;
                    indPointInPolyline = _.indexOf(pp, fp, 0);
                }
            })

            let polylineTemp = TrackLayerProvider.createTempPolyline(currentPoint, {lat: lat, lng: lng});
            polylineTemp.addTo(this.map);

            currentPoint.lat = lat;
            currentPoint.lng = lng;

            if (currentPoint.profile === TracksManager.PROFILE_LINE && !currentPoint.geometry || !currentPoint.profile) {
                currentPolyline._latlngs[indPointInPolyline] = currentPoint;
                currentPolyline.setLatLngs(currentPolyline._latlngs);
            } else {
                let currentPolyline;
                let nextPolyline;

                let prevPoint = trackPoints[indPoint - 1];
                let nextPoint = trackPoints[indPoint + 1];

                if (prevPoint) {
                    currentPolyline = TrackLayerProvider.getPolylineByPoints(_.cloneDeep(currentPoint), polylines);
                    if (prevPoint.geometry) {
                        if (prevPoint.profile === TracksManager.PROFILE_LINE) {
                            let newGeo = _.cloneDeep(currentPoint.geometry);
                            newGeo[newGeo.length - 1] = currentPoint;
                            currentPoint.geometry = newGeo;
                        } else {
                            currentPoint.geometry = await TracksManager.updateRouteBetweenPoints(this.ctx, prevPoint, currentPoint);
                        }
                    }
                }

                if (nextPoint) {
                    nextPolyline = TrackLayerProvider.getPolylineByPoints(_.cloneDeep(nextPoint), polylines);
                    if (nextPoint.geometry) {
                        if (currentPoint.profile === TracksManager.PROFILE_LINE) {
                            let newGeo = _.cloneDeep(nextPoint.geometry);
                            newGeo[0] = currentPoint;
                            nextPoint.geometry = newGeo;
                        } else {
                            nextPoint.geometry = await TracksManager.updateRouteBetweenPoints(this.ctx, currentPoint, nextPoint);
                        }
                    }
                }

                let firstPoint = indPoint === 0;
                let lastPoint = indPoint === trackPoints.length - 1;

                if (firstPoint) {
                    this.updatePolyline(currentPoint.profile, nextPoint, nextPolyline);
                } else if (lastPoint) {
                    this.updatePolyline(prevPoint.profile, currentPoint, currentPolyline);
                } else {
                    this.updatePolyline(currentPoint.profile, nextPoint, nextPolyline);
                    this.updatePolyline(prevPoint.profile, currentPoint, currentPolyline);
                }
            }
            this.map.removeLayer(polylineTemp);
        } else {
            let indWpt = this.ctx.selectedGpxFile.dragPoint.indWpt;
            if (indWpt !== -1) {
                let currentWpt = this.ctx.selectedGpxFile.wpts[indWpt];
                currentWpt.lat = lat;
                currentWpt.lon = lng;
            }
        }
        TracksManager.getTrackWithAnalysis(TracksManager.GET_ANALYSIS, this.ctx, this.ctx.setLoadingContextMenu, trackPoints).then(res => {
            res.addPoint = false;
            delete res.dragPoint;
            this.ctx.setSelectedGpxFile({...res});
        });
    }

    updatePolyline(profile, point, polyline) {
        let latlngs = [];
        point.geometry.forEach(point => {
            latlngs.push(new L.LatLng(point.lat, point.lng))
        })

        if (polyline) {
            polyline.setLatLngs(latlngs);
            polyline.setStyle({
                color: this.ctx.creatingRouteMode.colors[profile ? profile : TracksManager.PROFILE_LINE]
            });
        }
    }
}