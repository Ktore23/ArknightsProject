import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js';
import { loadCharactersFromFirebase, setupUI } from './ui.js';

var canvas, hitboxCanvas, hitboxCtx, gl, shader, batcher, mvp = new spine.webgl.Matrix4(), skeletonRenderer, assetManager;
var debugRenderer, debugShader, shapes;
var lastFrameTime, skeletons = {}, skeletonNames = [];
var skeletonData = []; // Lưu trữ toàn bộ dữ liệu nhân vật từ Firebase
var velocities = {};
var keys = {};
var lastAnimation = {};
var showHitbox = true;
var isAttacking = false;
var mousePosition = { x: 0, y: 0 };
var health = {};
var attackHitboxes = [];
var isLeftMouseClicked = false;
var hasTriggeredAttack = false; // Biến mới để theo dõi trạng thái Attack

// Khởi tạo Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAlqdZJmSvvyhTu1x_4ymhMqFvFxPhLOKM",
    authDomain: "arknights-2bf18.firebaseapp.com",
    projectId: "arknights-2bf18",
    storageBucket: "arknights-2bf18.firebasestorage.app",
    messagingSenderId: "702475861792",
    appId: "your-app-id"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Hàm để chia sẻ skeletonNames với các module khác
export function getSkeletonNames() {
    return skeletonNames;
}

// Cập nhật skeletonNames và skeletonData
export function updateSkeletonData(newNames, characters) {
    skeletonNames = newNames;
    skeletonData = characters;
}

// Thêm nhân vật mới vào danh sách skeletons
export function addCharacter(name) {
    const character = skeletonData.find(c => c.name === name);
    if (!character) {
        console.error(`Character ${name} not found in skeletonData`);
        return false;
    }

    if (skeletons[name]) {
        console.warn(`Character ${name} already rendered`);
        return false;
    }

    try {
        const skeleton = loadSkeleton(name, "Move", false, "default", skeletonData);
        if (skeleton) {
            const index = Object.keys(skeletons).length;
            skeletons[name] = skeleton;
            skeletons[name].skeleton.x = (canvas.width / 4) * (index + 0.5);
            skeletons[name].skeleton.y = canvas.height / 2;
            if (name !== $("#playerCharacter").val()) {
                velocities[name] = {
                    vx: (Math.random() - 0.5) * 200,
                    vy: (Math.random() - 0.5) * 200
                };
            }
            lastAnimation[name] = "Move";
            health[name] = 50;
            return true;
        }
    } catch (e) {
        console.error(`Error adding character ${name}:`, e.message);
        document.getElementById("error").textContent += `Error adding character ${name}: ${e.message}. `;
    }
    return false;
}

// Hàm khởi tạo nhân vật khi chọn từ dropdown
export function initializeSelectedCharacter() {
    const selectedCharacter = $("#playerCharacter").val();
    if (!selectedCharacter || !skeletonNames.includes(selectedCharacter)) {
        console.warn("No valid character selected in playerCharacter dropdown.");
        return;
    }

    try {
        const skeleton = loadSkeleton(selectedCharacter, "Move", false, "default", skeletonData);
        if (skeleton) {
            skeletons[selectedCharacter] = skeleton;
            skeletons[selectedCharacter].skeleton.x = canvas.width / 2;
            skeletons[selectedCharacter].skeleton.y = canvas.height / 2;
            lastAnimation[selectedCharacter] = "Move";
            health[selectedCharacter] = 50;
            console.log(`Successfully initialized character: ${selectedCharacter}`);
            lastFrameTime = Date.now() / 1000;
            requestAnimationFrame(render);
        } else {
            console.error(`Failed to load skeleton for ${selectedCharacter}`);
            document.getElementById("error").textContent += `Failed to load skeleton for ${selectedCharacter}. `;
        }
    } catch (e) {
        console.error(`Error loading skeleton for ${selectedCharacter}:`, e.message);
        document.getElementById("error").textContent += `Error loading skeleton for ${selectedCharacter}: ${e.message}. `;
    }
}

function init() {
    console.log("Starting init() in render.js");
    canvas = document.getElementById("canvas");
    hitboxCanvas = document.getElementById("hitboxCanvas");
    hitboxCtx = hitboxCanvas.getContext("2d");

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    hitboxCanvas.width = window.innerWidth;
    hitboxCanvas.height = window.innerHeight;

    var config = { alpha: true };
    gl = canvas.getContext("webgl", config) || canvas.getContext("experimental-webgl", config);
    if (!gl) {
        document.getElementById("error").textContent = "Error: WebGL not supported";
        return;
    }

    if (!spine || !spine.webgl) {
        document.getElementById("error").textContent = "Error: spine.webgl not defined. Ensure spine-webgl.js is from branch 3.8 (spine-ts/webgl/dist)";
        return;
    }

    shader = spine.webgl.Shader.newTwoColoredTextured(gl);
    batcher = new spine.webgl.PolygonBatcher(gl);
    mvp.ortho2d(0, 0, canvas.width - 1, canvas.height - 1);
    skeletonRenderer = new spine.webgl.SkeletonRenderer(gl);
    assetManager = new spine.webgl.AssetManager(gl);

    debugRenderer = new spine.webgl.SkeletonDebugRenderer(gl);
    debugShader = spine.webgl.Shader.newColored(gl);
    shapes = new spine.webgl.ShapeRenderer(gl);

    console.log("Calling loadCharactersFromFirebase...");
    loadCharactersFromFirebase(db).then(() => {
        console.log("loadCharactersFromFirebase completed, skeletonNames:", skeletonNames);
        console.log("skeletonData:", skeletonData);
        if (skeletonNames.length === 0) {
            console.warn("No skeleton names loaded. Check Firestore data.");
            document.getElementById("error").textContent = "No characters loaded from Firestore.";
            return;
        }

        skeletonData.forEach(character => {
            console.log(`Preloading assets for character: ${character.name}`);
            console.log(`skelPath: ${character.skelPath}, atlasPath: ${character.atlasPath}`);
            assetManager.loadBinary(character.skelPath);
            assetManager.loadTextureAtlas(character.atlasPath);
        });

        $(document).ready(() => {
            console.log("Document ready, calling setupUI...");
            setupUI();
            const playerCharacterSelect = $("#playerCharacter");
            if (!playerCharacterSelect.length) {
                console.error("Dropdown with id 'playerCharacter' not found in DOM. Cannot attach change event.");
                return;
            }
            playerCharacterSelect.on("change", function() {
                skeletons = {};
                velocities = {};
                lastAnimation = {};
                health = {};
                isLeftMouseClicked = false;
                hasTriggeredAttack = false;
                initializeSelectedCharacter();
            });
        });

        requestAnimationFrame(checkAssetsLoaded);
    }).catch(error => {
        console.error("Error in loadCharactersFromFirebase:", error);
        document.getElementById("error").textContent = "Error loading characters: " + error.message;
    });

    window.addEventListener('keydown', function (event) {
        keys[event.code] = true;
    });
    window.addEventListener('keyup', function (event) {
        keys[event.code] = false;
    });

    canvas.addEventListener('mousemove', function (event) {
        const rect = canvas.getBoundingClientRect();
        mousePosition.x = event.clientX - rect.left;
        mousePosition.y = event.clientY - rect.top;
    });

    canvas.addEventListener('mousedown', function (event) {
        if (event.button === 0) {
            isLeftMouseClicked = true;
            console.log("Mouse left clicked on canvas");
        }
    });

    canvas.addEventListener('mouseup', function (event) {
        if (event.button === 0) {
            isLeftMouseClicked = false;
            console.log("Mouse left released on canvas");
        }
    });

    const settingsElements = ['playerCharacter', 'addCharacter', 'autoMoveToggle'];
    settingsElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('mousedown', function (event) {
                event.stopPropagation();
                console.log(`Mouse event stopped on element: ${id}`);
            });
            element.addEventListener('click', function (event) {
                event.stopPropagation();
                console.log(`Click event stopped on element: ${id}`);
            });
        }
    });
}

function checkAssetsLoaded() {
    if (assetManager.isLoadingComplete()) {
        console.log("Assets preloading complete, waiting for player selection...");
    } else {
        requestAnimationFrame(checkAssetsLoaded);
    }
}

function loadSkeleton(name, initialAnimation, premultipliedAlpha, skin, data) {
    if (skin === undefined) skin = "default";

    const character = data.find(c => c.name === name);
    if (!character) {
        console.error(`Character ${name} not found in data`);
        return null;
    }

    let atlas = null;
    try {
        atlas = assetManager.get(character.atlasPath);
        if (!atlas) {
            console.error(`Atlas not loaded for ${character.atlasPath}`);
            return null;
        }
    } catch (e) {
        console.error(`Failed to load atlas for ${character.atlasPath}: ${e.message}`);
        return null;
    }

    let skeletonData = null;
    try {
        const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
        const skeletonBinary = new spine.SkeletonBinary(atlasLoader);
        skeletonBinary.scale = 0.5;

        const binaryData = assetManager.get(character.skelPath);
        if (!binaryData) {
            console.error(`Skeleton binary not loaded for ${character.skelPath}`);
            return null;
        }

        skeletonData = skeletonBinary.readSkeletonData(binaryData);
        if (!skeletonData) {
            console.error(`Failed to parse skeleton data from ${character.skelPath}`);
            return null;
        }

        if (!skeletonData.bones || !skeletonData.bones.length || !skeletonData.slots.length || !skeletonData.skins.length) {
            console.error("Invalid skeleton data: No bones, slots, or skins");
            return null;
        }
        if (!skeletonData.animations || !skeletonData.animations.length) {
            console.error("No animations found in skeleton data");
            return null;
        }
    } catch (e) {
        console.error(`Failed to read skeleton data for ${character.skelPath}: ${e.message}`);
        return null;
    }

    const skeleton = new spine.Skeleton(skeletonData);
    skeleton.setSkinByName(skin);
    const bounds = calculateSetupPoseBounds(skeleton);

    const animationStateData = new spine.AnimationStateData(skeleton.data);
    const animationState = new spine.AnimationState(animationStateData);

    const animationToUse = skeleton.data.animations.find(anim => anim.name.toLowerCase() === initialAnimation.toLowerCase())?.name || skeleton.data.animations[0]?.name;
    if (!animationToUse) {
        console.error(`No valid animation found for ${name}`);
        return null;
    }
    animationState.setAnimation(0, animationToUse, true);

    animationState.addListener({
        start: function (track) {
            console.log("Animation on track " + track.trackIndex + " started: " + track.animation.name);
            if (name === $("#playerCharacter").val() && track.animation.name === "Attack") {
                isAttacking = true;
                hasTriggeredAttack = true;
            }
        },
        interrupt: function (track) { console.log("Animation on track " + track.trackIndex + " interrupted"); },
        end: function (track) { console.log("Animation on track " + track.trackIndex + " ended"); },
        disposed: function (track) { console.log("Animation on track " + track.trackIndex + " disposed"); },
        complete: function (track) {
            console.log("Animation on track " + track.trackIndex + " completed: " + track.animation.name);
            if (name === $("#playerCharacter").val() && track.animation.name === "Attack") {
                isAttacking = false;
                hasTriggeredAttack = false;
                attackHitboxes = [];
                const previousAnim = lastAnimation[name] === "Attack" ? "Move" : lastAnimation[name] || "Move";
                animationState.setAnimation(0, previousAnim, true);
                console.log("Switched back to animation: " + previousAnim);
            }
        },
        event: function (track, event) {
            console.log("Event on track " + track.trackIndex + ": " + JSON.stringify(event));
            if (name === $("#playerCharacter").val() && event.data.name === "OnAttack") {
                const hitboxes = Object.keys(skeletons).map(name => {
                    const skeleton = skeletons[name].skeleton;
                    return { name, x: skeleton.x, y: skeleton.y, radius: 50, skeleton };
                });

                attackHitboxes.forEach(attackHitbox => {
                    hitboxes.forEach(hitbox => {
                        if (attackHitbox.name === hitbox.name) return;
                        const dx = hitbox.x - attackHitbox.x;
                        const dy = hitbox.y - attackHitbox.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < attackHitbox.radius + hitbox.radius) {
                            const angleToTarget = Math.atan2(dy, dx) * (180 / Math.PI);
                            const angleToMouse = Math.atan2(canvas.height - mousePosition.y - attackHitbox.y, mousePosition.x - attackHitbox.x) * (180 / Math.PI);
                            const angleDiff = Math.abs(angleToTarget - angleToMouse);
                            const normalizedAngleDiff = Math.min(angleDiff, 360 - angleDiff);
                            if (normalizedAngleDiff <= 45) {
                                if (health[hitbox.name] > 0) {
                                    health[hitbox.name] -= 25;
                                    console.log(`Đã tấn công ${hitbox.name}! Máu còn lại: ${health[hitbox.name]}`);
                                    if (health[hitbox.name] <= 0) {
                                        console.log(`${hitbox.name} đã bị tiêu diệt!`);
                                        delete skeletons[hitbox.name];
                                        delete velocities[hitbox.name];
                                        delete health[hitbox.name];
                                        $("#playerCharacter").trigger("change");
                                        $(document).ready(() => {
                                            setupUI();
                                        });
                                    }
                                }
                            }
                        }
                    });
                });
            }
        }
    });

    return { skeleton: skeleton, state: animationState, bounds: bounds, premultipliedAlpha: premultipliedAlpha };
}

function calculateSetupPoseBounds(skeleton) {
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform();
    var offset = new spine.Vector2();
    var size = new spine.Vector2();
    skeleton.getBounds(offset, size, []);
    return { offset: offset, size: size };
}

function render() {
    var now = Date.now() / 1000;
    var delta = now - lastFrameTime;
    lastFrameTime = now;

    resize();

    gl.clearColor(0.3, 0.3, 0.3, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    shader.bind();
    shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
    shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, mvp.values);
    batcher.begin(shader);

    const sortedSkeletons = Object.keys(skeletons).map(name => ({
        name,
        y: skeletons[name].skeleton.y
    })).sort((a, b) => b.y - a.y);

    hitboxCtx.clearRect(0, 0, hitboxCanvas.width, hitboxCanvas.height);
    if (showHitbox) {
        hitboxCtx.strokeStyle = "rgba(255, 0, 0, 0.8)";
        hitboxCtx.lineWidth = 2;
    }

    const hitboxes = [];
    attackHitboxes = [];

    sortedSkeletons.forEach(({ name }) => {
        const { skeleton, state, bounds, premultipliedAlpha } = skeletons[name];
        const currentAnimation = state.tracks[0]?.animation?.name || skeleton.data.animations[0]?.name;

        const baseRadius = 50;
        const current = { name, x: skeleton.x, y: skeleton.y, radius: baseRadius, skeleton };
        hitboxes.push(current);

        if (name === $("#playerCharacter").val()) {
            let vx = 0, vy = 0, speed = 100;
            if (!isAttacking) {
                if (keys['ArrowLeft'] || keys['KeyA']) { vx = -speed; skeleton.scaleX = -1; }
                if (keys['ArrowRight'] || keys['KeyD']) { vx = speed; skeleton.scaleX = 1; }
                if (keys['ArrowUp'] || keys['KeyW']) vy = speed;
                if (keys['ArrowDown'] || keys['KeyS']) vy = -speed;
                skeleton.x += vx * delta;
                skeleton.y += vy * delta;
                const margin = 0;
                skeleton.x = Math.max(margin + bounds.size.x / 2, Math.min(canvas.width - margin - bounds.size.x / 2, skeleton.x));
                skeleton.y = Math.max(margin + bounds.size.y / 2, Math.min(canvas.height - margin - bounds.size.y / 2, skeleton.y));
            }

            if (isLeftMouseClicked && currentAnimation !== "Attack" && !hasTriggeredAttack) {
                lastAnimation[name] = currentAnimation;
                state.setAnimation(0, "Attack", false);
                isLeftMouseClicked = false;
                hasTriggeredAttack = true;
                console.log("Triggered Attack animation");
            } else if (!isLeftMouseClicked && currentAnimation !== "Attack" && !isAttacking) {
                const idleAnim = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "idle")?.name || skeleton.data.animations[0]?.name || "Idle";
                const targetAnim = (vx !== 0 || vy !== 0) ? "Move" : idleAnim;
                if (lastAnimation[name] !== targetAnim) {
                    state.setAnimation(0, targetAnim, true);
                    lastAnimation[name] = targetAnim;
                    console.log("Switched to animation: " + targetAnim);
                }
            }

            if (state.tracks[0]?.animation.name === "Attack") {
                const dx = mousePosition.x - skeleton.x;
                const dy = (canvas.height - mousePosition.y) - skeleton.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                skeleton.scaleX = dx >= 0 ? 1 : -1;

                const attackRadius = 100;
                const attackRangeExtension = 30;
                let attackHitboxX = skeleton.x;
                let attackHitboxY = skeleton.y;

                if (distance > 0) {
                    const nx = dx / distance;
                    const ny = dy / distance;
                    attackHitboxX += nx * attackRangeExtension;
                    attackHitboxY += ny * attackRangeExtension;
                }

                const attackHitbox = { name, x: attackHitboxX, y: attackHitboxY, radius: attackRadius, skeleton };
                attackHitboxes.push(attackHitbox);

                if (showHitbox) {
                    hitboxCtx.strokeStyle = "rgba(255, 165, 0, 0.8)";
                    hitboxCtx.fillStyle = "rgba(255, 165, 0, 0.3)";
                    hitboxCtx.beginPath();
                    const angleToMouse = Math.atan2(-(canvas.height - mousePosition.y - skeleton.y), mousePosition.x - skeleton.x);
                    const startAngle = angleToMouse - Math.PI / 4;
                    const endAngle = angleToMouse + Math.PI / 4;
                    hitboxCtx.arc(skeleton.x, canvas.height - skeleton.y, attackRadius, startAngle, endAngle);
                    hitboxCtx.fill();
                    hitboxCtx.stroke();
                    hitboxCtx.strokeStyle = "rgba(255, 0, 0, 0.8)";
                }
            }
        } else if ($("#autoMoveToggle").is(":checked")) {
            skeleton.x += velocities[name].vx * delta;
            skeleton.y += velocities[name].vy * delta;
            if (velocities[name].vx > 0) skeleton.scaleX = 1;
            else if (velocities[name].vx < 0) skeleton.scaleX = -1;
            const margin = 0;
            if (skeleton.x < margin + bounds.size.x / 2 || skeleton.x > canvas.width - margin - bounds.size.x / 2)
                velocities[name].vx *= -1;
            if (skeleton.y < margin + bounds.size.y / 2 || skeleton.y > canvas.height - margin - bounds.size.y / 2)
                velocities[name].vy *= -1;
        }

        state.update(delta);
        state.apply(skeleton);
        skeleton.updateWorldTransform();

        skeletonRenderer.vertexEffect = null;
        skeletonRenderer.premultipliedAlpha = premultipliedAlpha;
        skeletonRenderer.draw(batcher, skeleton);

        if (showHitbox) {
            const hitbox = hitboxes.find(h => h.name === name);
            hitboxCtx.beginPath();
            hitboxCtx.arc(hitbox.x, canvas.height - hitbox.y, hitbox.radius, 0, 2 * Math.PI);
            hitboxCtx.stroke();

            if (health[name] > 0) {
                const healthWidth = 50;
                const healthHeight = 5;
                const x = hitbox.x - healthWidth / 2;
                const y = canvas.height - (hitbox.y + hitbox.radius + 150);
                const healthPercentage = Math.max(0, health[name]) / 50;

                hitboxCtx.fillStyle = "rgba(100, 100, 100, 0.8)";
                hitboxCtx.fillRect(x, y, healthWidth, healthHeight);

                const red = Math.floor((1 - healthPercentage) * 255);
                const green = Math.floor(healthPercentage * 255);
                hitboxCtx.fillStyle = `rgba(${red}, ${green}, 0, 0.8)`;
                hitboxCtx.fillRect(x, y, healthWidth * healthPercentage, healthHeight);

                hitboxCtx.strokeStyle = "rgba(255, 255, 255, 0.8)";
                hitboxCtx.lineWidth = 1;
                hitboxCtx.strokeRect(x, y, healthWidth, healthHeight);

                hitboxCtx.strokeStyle = "rgba(255, 0, 0, 0.8)";
                hitboxCtx.lineWidth = 2;
            }
        }
    });

    batcher.end();
    shader.unbind();

    requestAnimationFrame(render);
}

function resize() {
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (canvas.width != w || canvas.height != h) {
        canvas.width = w;
        canvas.height = h;
        hitboxCanvas.width = w;
        hitboxCanvas.height = h;
    }

    var maxSize = { x: 0, y: 0 };
    Object.keys(skeletons).forEach(name => {
        var bounds = skeletons[name]?.bounds;
        if (bounds) {
            maxSize.x = Math.max(maxSize.x, bounds.size.x);
            maxSize.y = Math.max(maxSize.y, bounds.size.y);
        }
    });

    var centerX = canvas.width / 2;
    var centerY = canvas.height / 2;
    var scaleX = maxSize.x / canvas.width;
    var scaleY = maxSize.y / canvas.height;
    var scale = Math.max(scaleX, scaleY) * 1.5;
    if (scale < 1) scale = 1;
    var width = canvas.width * scale;
    var height = canvas.height * scale;

    mvp.ortho2d(centerX - width / 2, centerY - height / 2, width, height);
    gl.viewport(0, 0, canvas.width, canvas.height);
}

init();