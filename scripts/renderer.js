import * as CG from './transforms.js';
import { Matrix, Vector } from "./matrix.js";

const LEFT =   32; // binary 100000
const RIGHT =  16; // binary 010000
const BOTTOM = 8;  // binary 001000
const TOP =    4;  // binary 000100
const FAR =    2;  // binary 000010
const NEAR =   1;  // binary 000001
const FLOAT_EPSILON = 0.000001;

class Renderer {
    // canvas:              object ({id: __, width: __, height: __})
    // scene:               object (...see description on Canvas)
    constructor(canvas, scene) {
        this.canvas = document.getElementById(canvas.id);
        this.canvas.width = canvas.width;
        this.canvas.height = canvas.height;
        this.ctx = this.canvas.getContext('2d');
        this.scene = this.processScene(scene);
        this.enable_animation = false;  // <-- disabled for easier debugging; enable for animation
        this.start_time = null;
        this.prev_time = null;
    }

    //
    updateTransforms(time, delta_time) {
        // TODO: update any transformations needed for animation
        for (let i = 0; i < this.scene.models.length; i++){
            let model = this.scene.models[i];

            if (!model.animation){
                continue;
            }

            let theta = 2 * Math.PI * model.animation.rps * time / 1000;
            let rotation = new Matrix(4, 4);

            if (model.animation.axis === 'x'){
                CG.mat4x4RotateX(rotation, theta);
            }
            else if (model.animation.axis === 'y'){
                CG.mat4x4RotateY(rotation, theta);
            }
            else if (model.animation.axis === 'z'){
                CG.mat4x4RotateZ(rotation, theta);
            }
            else{
                continue;
            }

            let translate1 = new Matrix(4, 4);
            CG.mat4x4Translate(
                translate1,
                -model.center.x,
                -model.center.y,
                -model.center.z
            );

            let translate2 = new Matrix(4, 4);
            CG.mat4x4Translate(
                translate2,
                model.center.x,
                model.center.y,
                model.center.z
            );

            model.matrix = Matrix.multiply([
                translate2,
                rotation,
                translate1
            ]);
        }
    }

    //
    rotateLeft() {
        let n = this.scene.view.srp.subtract(this.scene.view.prp);
        let x = n.x;
        let z = n.z;
        let theta = -2 * Math.PI / 60;
        n.x = x * Math.cos(theta) - z * Math.sin(theta);
        n.z = x * Math.sin(theta) + z * Math.cos(theta);
        this.scene.view.srp = n.add(this.scene.view.prp);
        this.draw();
    }
    
    //
    rotateRight() {
        let n = this.scene.view.srp.subtract(this.scene.view.prp);
        let x = n.x;
        let z = n.z;
        let theta = 2 * Math.PI / 60;
        n.x = x * Math.cos(theta) - z * Math.sin(theta);
        n.z = x * Math.sin(theta) + z * Math.cos(theta);
        this.scene.view.srp = n.add(this.scene.view.prp);
        this.draw();
    }
    
    //
    moveLeft() {

    }
    
    //
    moveRight() {

    }
    
    //
    moveBackward() {
        let n = this.scene.view.prp.subtract(this.scene.view.srp);
        n.normalize();
        this.scene.view.prp = this.scene.view.prp.add(n);
        this.scene.view.srp = this.scene.view.srp.add(n);
        this.draw();
    }
    
    //
    moveForward() {
        let n = this.scene.view.prp.subtract(this.scene.view.srp);
        n.normalize();
        this.scene.view.prp = this.scene.view.prp.subtract(n);
        this.scene.view.srp = this.scene.view.srp.subtract(n);
        this.draw();
    }

    //
    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        let view = this.scene.view;
        let n_per = CG.mat4x4Perspective(view.prp, view.srp, view.vup, view.clip);
        let m_per = CG.mat4x4MPer();
        let viewport = CG.mat4x4Viewport(this.canvas.width, this.canvas.height);
        let z_min = -view.clip[4] / view.clip[5];

        for (let i = 0; i < this.scene.models.length; i++) {
            let model = this.scene.models[i];
            if (!model.vertices || !model.edges) {
                continue;
            }

            let transformed = [];
            for (let j = 0; j < model.vertices.length; j++) {
                transformed.push(Matrix.multiply([n_per, model.vertices[j]]));
            }

            for (let j = 0; j < model.edges.length; j++) {
                let edge = model.edges[j];
                for (let k = 0; k < edge.length - 1; k++) {
                    let line = {
                        pt0: transformed[edge[k]],
                        pt1: transformed[edge[k + 1]]
                    };

                    line = this.clipLinePerspective(line, z_min);
                    if (line === null) {
                        continue;
                    }

                    let p0 = Matrix.multiply([viewport, m_per, line.pt0]);
                    let p1 = Matrix.multiply([viewport, m_per, line.pt1]);

                    let x0 = p0.x / p0.w;
                    let y0 = p0.y / p0.w;
                    let x1 = p1.x / p1.w;
                    let y1 = p1.y / p1.w;
                    this.drawLine(x0, y0, x1, y1);
                }
            }
        }
    }

    // Get outcode for a vertex
    // vertex:       Vector4 (transformed vertex in homogeneous coordinates)
    // z_min:        float (near clipping plane in canonical view volume)
    outcodePerspective(vertex, z_min) {
        let outcode = 0;
        if (vertex.x < (vertex.z - FLOAT_EPSILON)) {
            outcode += LEFT;
        }
        else if (vertex.x > (-vertex.z + FLOAT_EPSILON)) {
            outcode += RIGHT;
        }
        if (vertex.y < (vertex.z - FLOAT_EPSILON)) {
            outcode += BOTTOM;
        }
        else if (vertex.y > (-vertex.z + FLOAT_EPSILON)) {
            outcode += TOP;
        }
        if (vertex.z < (-1.0 - FLOAT_EPSILON)) {
            outcode += FAR;
        }
        else if (vertex.z > (z_min + FLOAT_EPSILON)) {
            outcode += NEAR;
        }
        return outcode;
    }

    // Clip line - should either return a new line (with two endpoints inside view volume)
    //             or null (if line is completely outside view volume)
    // line:         object {pt0: Vector4, pt1: Vector4}
    // z_min:        float (near clipping plane in canonical view volume)
    clipLinePerspective(line, z_min) {
        let result = null;
        let p0 = CG.Vector4(line.pt0.x, line.pt0.y, line.pt0.z, 1);
        let p1 = CG.Vector4(line.pt1.x, line.pt1.y, line.pt1.z, 1);
        let out0 = this.outcodePerspective(p0, z_min);
        let out1 = this.outcodePerspective(p1, z_min);

        while (true) {
            if ((out0 | out1) === 0) {
                result = { pt0: p0, pt1: p1 };
                break;
            }
            if ((out0 & out1) !== 0) {
                break;
            }

            let out = (out0 !== 0) ? out0 : out1;
            let dx = p1.x - p0.x;
            let dy = p1.y - p0.y;
            let dz = p1.z - p0.z;
            let t;

            if (out & LEFT) {
                t = (-p0.x + p0.z) / (dx - dz);
            }
            else if (out & RIGHT) {
                t = (p0.x + p0.z) / (-dx - dz);
            }
            else if (out & BOTTOM) {
                t = (-p0.y + p0.z) / (dy - dz);
            }
            else if (out & TOP) {
                t = (p0.y + p0.z) / (-dy - dz);
            }
            else if (out & FAR) {
                t = (-p0.z - 1) / dz;
            }
            else {
                t = (p0.z - z_min) / (-dz);
            }

            let pt = CG.Vector4(p0.x + t * dx, p0.y + t * dy, p0.z + t * dz, 1);
            if (out === out0) {
                p0 = pt;
                out0 = this.outcodePerspective(p0, z_min);
            }
            else {
                p1 = pt;
                out1 = this.outcodePerspective(p1, z_min);
            }
        }

        return result;
    }

    //
    animate(timestamp) {
        // Get time and delta time for animation
        if (this.start_time === null) {
            this.start_time = timestamp;
            this.prev_time = timestamp;
        }
        let time = timestamp - this.start_time;
        let delta_time = timestamp - this.prev_time;

        // Update transforms for animation
        this.updateTransforms(time, delta_time);

        // Draw slide
        this.draw();

        // Invoke call for next frame in animation
        if (this.enable_animation) {
            window.requestAnimationFrame((ts) => {
                this.animate(ts);
            });
        }

        // Update previous time to current one for next calculation of delta time
        this.prev_time = timestamp;
    }

    //
    updateScene(scene) {
        this.scene = this.processScene(scene);
        if (!this.enable_animation) {
            this.draw();
        }
    }

    //
    processScene(scene) {
        let processed = {
            view: {
                prp: CG.Vector3(scene.view.prp[0], scene.view.prp[1], scene.view.prp[2]),
                srp: CG.Vector3(scene.view.srp[0], scene.view.srp[1], scene.view.srp[2]),
                vup: CG.Vector3(scene.view.vup[0], scene.view.vup[1], scene.view.vup[2]),
                clip: [...scene.view.clip]
            },
            models: []
        };

        for (let i = 0; i < scene.models.length; i++) {
            let model = { type: scene.models[i].type };
            if (model.type === 'generic') {
                model.vertices = [];
                model.edges = JSON.parse(JSON.stringify(scene.models[i].edges));
                for (let j = 0; j < scene.models[i].vertices.length; j++) {
                    model.vertices.push(CG.Vector4(scene.models[i].vertices[j][0],
                                                   scene.models[i].vertices[j][1],
                                                   scene.models[i].vertices[j][2],
                                                   1));
                    if (scene.models[i].hasOwnProperty('animation')) {
                        model.animation = JSON.parse(JSON.stringify(scene.models[i].animation));
                    }
                }
            }
            else if (model.type === 'cylinder') {

                let center = scene.models[i].center;
                let radius = scene.models[i].radius;
                let height = scene.models[i].height;
                let sides = scene.models[i].sides;
                model.vertices = [];
                model.edges = [];
                let bottom = [];
                let top = [];

                for (let s = 0; s < sides; s++) {
                    let theta = (2 * Math.PI * s) / sides;
                    let x = center[0] + radius * Math.cos(theta);
                    let z = center[2] + radius * Math.sin(theta);
                    let b = model.vertices.length;
                    model.vertices.push(CG.Vector4(x, center[1] - height / 2, z, 1));
                    bottom.push(b);
                    let t = model.vertices.length;
                    model.vertices.push(CG.Vector4(x, center[1] + height / 2, z, 1));
                    top.push(t);
                }

                for (let s = 0; s < sides; s++) {
                    model.edges.push([bottom[s], bottom[(s + 1) % sides]]);
                    model.edges.push([top[s], top[(s + 1) % sides]]);
                    model.edges.push([bottom[s], top[s]]);
                }
            }
            else if (model.type === 'sphere') {
                let center = scene.models[i].center;
                let radius = scene.models[i].radius;
                let slices = scene.models[i].slices;
                let stacks = scene.models[i].stacks;
                model.vertices = [];
                model.edges = [];

                for (let stack = 0; stack <= stacks; stack++) {
                    let phi = ((stack / stacks) * Math.PI) - (Math.PI / 2);
                    for (let slice = 0; slice <= slices; slice++) {
                        let theta = (slice / slices) * (2 * Math.PI);
                        let x = center[0] + radius * Math.cos(phi) * Math.cos(theta);
                        let y = center[1] + radius * Math.sin(phi);
                        let z = center[2] + radius * Math.cos(phi) * Math.sin(theta);
                        model.vertices.push(CG.Vector4(x, y, z, 1));
                    }
                }

                for (let stack = 0; stack < stacks; stack++) {
                    for (let slice = 0; slice < slices; slice++) {
                        let a = stack * (slices + 1) + slice;
                        let b = a + 1;
                        let c = a + (slices + 1);
                        let d = c + 1;
                        model.edges.push([a, b]);
                        model.edges.push([a, c]);
                        model.edges.push([b, d]);
                        model.edges.push([c, d]);
                    }
                }
            }
            else {
                model.center = CG.Vector4(scene.models[i].center[0],
                                         scene.models[i].center[1],
                                         scene.models[i].center[2],
                                         1);
                for (let key in scene.models[i]) {
                    if (scene.models[i].hasOwnProperty(key) && key !== 'type' && key != 'center') {
                        model[key] = JSON.parse(JSON.stringify(scene.models[i][key]));
                    }
                }
            }

            model.matrix = new Matrix(4, 4);
            processed.models.push(model);
        }

        return processed;
    }
    
    // x0:           float (x coordinate of p0)
    // y0:           float (y coordinate of p0)
    // x1:           float (x coordinate of p1)
    // y1:           float (y coordinate of p1)
    drawLine(x0, y0, x1, y1) {
        this.ctx.strokeStyle = '#000000';
        this.ctx.beginPath();
        this.ctx.moveTo(x0, y0);
        this.ctx.lineTo(x1, y1);
        this.ctx.stroke();

        this.ctx.fillStyle = '#FF0000';
        this.ctx.fillRect(x0 - 2, y0 - 2, 4, 4);
        this.ctx.fillRect(x1 - 2, y1 - 2, 4, 4);
    }
};

export { Renderer };
