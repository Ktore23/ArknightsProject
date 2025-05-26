import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js';
import { loadCharactersFromFirebase, setupUI } from './ui.js';

var canvas, hitboxCanvas, hitboxCtx, gl, shader, batcher, mvp = new spine.webgl.Matrix4(), skeletonRenderer, assetManager;
var debugRenderer, debugShader, shapes;
var lastFrameTime, skeletons = {}, skeletonNames = [];
var skeletonData = [];
var velocities = {};
var keys = {};
var lastAnimation = {};
var showHitbox = true;
var showHealthBar = true;
var isAttacking = false;
var isInAttackState = {};
var attackStartTime = {};
var mousePosition = { x: 0, y: 0 };
var health = {};
var attackHitboxes = [];
var isLeftMouseClicked = false;
var hasTriggeredAttack = false;
var isDying = {};
var idleTime = {};
var isInRelaxState = {};
var isPlayingRandomAnimation = {};
var attackSequence = {};
var isMouseHeld = false;

var moveStates = {}; // { isMoving: boolean, moveTime: number, stopTime: number, waitForAnimationEnd: boolean }

// Thêm kích thước bản đồ cố định và camera
const WORLD_WIDTH = 2000; // Chiều rộng bản đồ thế giới
const WORLD_HEIGHT = 1500; // Chiều cao bản đồ thế giới
var camera = {
    x: 0, // Vị trí x của camera trong tọa độ thế giới
    y: 0, // Vị trí y của camera trong tọa độ thế giới
    zoom: 1 // Tỷ lệ thu phóng
};

const ATTACK_TIMEOUT = 5000;

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

export { showHitbox };
export function setShowHitbox(value) {
    showHitbox = value;
}

export { showHealthBar };
export function setShowHealthBar(value) {
    showHealthBar = value;
}

export function getSkeletonNames() {
    return skeletonNames;
}

export function updateSkeletonData(newNames, characters) {
    skeletonNames = newNames;
    skeletonData = characters;
}

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
        const isOperator = character.type === "operator";
        const initialAnimation = isOperator ? "Relax" : "Idle";
        const skelPathToUse = isOperator && character.altSkelPath ? character.altSkelPath : character.skelPath;
        const atlasPathToUse = isOperator && character.altAtlasPath ? character.altAtlasPath : character.atlasPath;

        const skeleton = loadSkeleton(name, initialAnimation, false, "default", skeletonData, skelPathToUse, atlasPathToUse);
        if (!skeleton) {
            console.error(`Failed to load skeleton for ${name}`);
            return false;
        }

        skeletons[name] = skeleton;

        const bounds = skeleton.bounds;
        if (!bounds || isNaN(bounds.size.x) || isNaN(bounds.size.y)) {
            console.error(`Invalid bounds for ${name}: size.x=${bounds?.size.x}, size.y=${bounds?.size.y}`);
            return false;
        }

        const margin = 50;
        const maxAttempts = 10;
        let placed = false;
        let attempts = 0;

        while (!placed && attempts < maxAttempts) {
            const minX = margin + bounds.size.x / 2;
            const maxX = WORLD_WIDTH - margin - bounds.size.x / 2;
            const minY = margin + bounds.size.y / 2;
            const maxY = WORLD_HEIGHT - margin - bounds.size.y / 2;

            skeleton.skeleton.x = minX + Math.random() * (maxX - minX);
            skeleton.skeleton.y = minY + Math.random() * (maxY - minY);

            let overlap = false;
            const minDist = 150;
            for (let otherName in skeletons) {
                if (otherName !== name) {
                    const otherSkeleton = skeletons[otherName].skeleton;
                    const dx = skeleton.skeleton.x - otherSkeleton.x;
                    const dy = skeleton.skeleton.y - otherSkeleton.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < minDist) {
                        overlap = true;
                        break;
                    }
                }
            }

            if (!overlap) {
                placed = true;
            }
            attempts++;
        }

        if (!placed) {
            console.warn(`Could not find valid position for ${name} after ${maxAttempts} attempts, placing at default position`);
            skeleton.skeleton.x = WORLD_WIDTH / 2;
            skeleton.skeleton.y = WORLD_HEIGHT / 2;
        }

        if (isNaN(skeleton.skeleton.x) || isNaN(skeleton.skeleton.y)) {
            console.error(`Invalid coordinates for ${name}: x=${skeleton.skeleton.x}, y=${skeleton.skeleton.y}`);
            return false;
        }

        console.log(`Placed ${name} at x=${skeleton.skeleton.x}, y=${skeleton.skeleton.y}`);

        if (name !== $("#playerCharacter").val()) {
            velocities[name] = { vx: 0, vy: 0 };
            lastAnimation[name] = initialAnimation;
            health[name] = 50;
            isDying[name] = false;
            idleTime[name] = 0;
            isInRelaxState[name] = isOperator;
            isInAttackState[name] = false;
            isPlayingRandomAnimation[name] = false;
            attackSequence[name] = { stage: null };
            moveStates[name] = { isMoving: $("#autoMoveToggle").is(":checked"), moveTime: 0, stopTime: 0, waitForAnimationEnd: false };
            if ($("#autoMoveToggle").is(":checked") && moveStates[name].isMoving) {
                velocities[name].vx = (Math.random() - 0.5) * 150;
                velocities[name].vy = (Math.random() - 0.5) * 150;
                console.log(`Initial movement for ${name} on add: vx=${velocities[name].vx}, vy=${velocities[name].vy}`);
            }
        }
        console.log(`Successfully added character: ${name} with animation: ${initialAnimation}, isInRelaxState: ${isInRelaxState[name]}`);
        return true;
    } catch (e) {
        console.error(`Error adding character ${name}:`, e.message);
        document.getElementById("error").textContent += `Error adding character ${name}: ${e.message}. `;
    }
    return false;
}

export function initializeSelectedCharacter() {
    const selectedCharacter = $("#playerCharacter").val();
    if (!selectedCharacter || !skeletonNames.includes(selectedCharacter)) {
        console.warn("No valid character selected in playerCharacter dropdown.");
        return;
    }

    try {
        const previousCharacter = Object.keys(skeletons).find(name => name === $("#playerCharacter").data("previousCharacter"));
        if (previousCharacter && previousCharacter !== selectedCharacter) {
            cleanupCharacter(previousCharacter);
        }
        $("#playerCharacter").data("previousCharacter", selectedCharacter);

        const character = skeletonData.find(c => c.name === selectedCharacter);
        const initialAnimation = character && character.type === "operator" ? "Relax" : "Move";
        const skelPathToUse = character.type === "operator" && character.altSkelPath ? character.altSkelPath : character.skelPath;
        const atlasPathToUse = character.type === "operator" && character.altAtlasPath ? character.altAtlasPath : character.atlasPath;

        if (skeletons[selectedCharacter]) {
            console.log(`Character ${selectedCharacter} already exists, setting as player and moving camera`);
            const skeleton = skeletons[selectedCharacter];
            camera.x = skeleton.skeleton.x;
            camera.y = skeleton.skeleton.y;
            lastAnimation[selectedCharacter] = initialAnimation;
            health[selectedCharacter] = 50;
            isDying[selectedCharacter] = false;
            idleTime[selectedCharacter] = 0;
            isInRelaxState[selectedCharacter] = character && character.type === "operator";
            isInAttackState[selectedCharacter] = false;
            isPlayingRandomAnimation[selectedCharacter] = false;
            attackSequence[selectedCharacter] = { stage: null };
            moveStates[selectedCharacter] = { isMoving: $("#autoMoveToggle").is(":checked"), moveTime: 0, stopTime: 0, waitForAnimationEnd: false };
            velocities[selectedCharacter] = { vx: 0, vy: 0 };
            refreshCanvas();
            return;
        }

        const skeleton = loadSkeleton(selectedCharacter, initialAnimation, false, "default", skeletonData, skelPathToUse, atlasPathToUse);
        if (skeleton) {
            skeletons[selectedCharacter] = skeleton;

            const bounds = skeleton.bounds;
            if (!bounds || isNaN(bounds.size.x) || isNaN(bounds.size.y)) {
                console.error(`Invalid bounds for ${selectedCharacter}: size.x=${bounds?.size.x}, size.y=${bounds?.size.y}`);
                return;
            }

            const margin = 50;
            const maxAttempts = 10;
            let placed = false;
            let attempts = 0;

            while (!placed && attempts < maxAttempts) {
                const minX = margin + bounds.size.x / 2;
                const maxX = WORLD_WIDTH - margin - bounds.size.x / 2;
                const minY = margin + bounds.size.y / 2;
                const maxY = WORLD_HEIGHT - margin - bounds.size.y / 2;

                skeleton.skeleton.x = minX + Math.random() * (maxX - minX);
                skeleton.skeleton.y = minY + Math.random() * (maxY - minY);

                let overlap = false;
                const minDist = 150;
                for (let otherName in skeletons) {
                    if (otherName !== selectedCharacter) {
                        const otherSkeleton = skeletons[otherName].skeleton;
                        const dx = skeleton.skeleton.x - otherSkeleton.x;
                        const dy = skeleton.skeleton.y - otherSkeleton.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < minDist) {
                            overlap = true;
                            break;
                        }
                    }
                }

                if (!overlap) {
                    placed = true;
                }
                attempts++;
            }

            if (!placed) {
                console.warn(`Could not find non-overlapping position for ${selectedCharacter} after ${maxAttempts} attempts, using default`);
                skeleton.skeleton.x = WORLD_WIDTH / 2;
                skeleton.skeleton.y = WORLD_HEIGHT / 2;
            }

            console.log(`Placed ${selectedCharacter} at x=${skeleton.skeleton.x}, y=${skeleton.skeleton.y}`);

            skeleton.hitbox = {
                x: skeleton.skeleton.x,
                y: skeleton.skeleton.y,
                radius: 50,
                name: selectedCharacter
            };

            camera.x = skeleton.skeleton.x;
            camera.y = skeleton.skeleton.y;
            lastAnimation[selectedCharacter] = initialAnimation;
            health[selectedCharacter] = 50;
            isDying[selectedCharacter] = false;
            idleTime[selectedCharacter] = 0;
            isInRelaxState[selectedCharacter] = character && character.type === "operator";
            isInAttackState[selectedCharacter] = false;
            isPlayingRandomAnimation[selectedCharacter] = false;
            attackSequence[selectedCharacter] = { stage: null };
            moveStates[selectedCharacter] = { isMoving: $("#autoMoveToggle").is(":checked"), moveTime: 0, stopTime: 0, waitForAnimationEnd: false };
            velocities[selectedCharacter] = { vx: 0, vy: 0 };

            console.log(`Successfully initialized character: ${selectedCharacter} with animation: ${initialAnimation}, isInRelaxState: ${isInRelaxState[selectedCharacter]}`);
            lastFrameTime = Date.now() / 1000;
            refreshCanvas();
        } else {
            console.error(`Failed to load skeleton for ${selectedCharacter}`);
            document.getElementById("error").textContent += `Failed to load skeleton for ${selectedCharacter}. `;
        }
    } catch (e) {
        console.error(`Error loading skeleton for ${selectedCharacter}:`, e.message);
        document.getElementById("error").textContent += `Error loading skeleton for ${selectedCharacter}: ${e.message}. `;
    }
}

export function refreshCanvas() {
    hitboxCtx.clearRect(0, 0, hitboxCanvas.width, hitboxCanvas.height);
    requestAnimationFrame(render);
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

    if (!canvas.width || !canvas.height || isNaN(canvas.width) || isNaN(canvas.height)) {
        console.error("Invalid canvas dimensions in init");
        document.getElementById("error").textContent = "Error: Invalid canvas dimensions";
        return;
    }

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
            if (character.altSkelPath && character.altAtlasPath) {
                console.log(`Preloading alternate assets: altSkelPath: ${character.altSkelPath}, altAtlasPath: ${character.altAtlasPath}`);
                assetManager.loadBinary(character.altSkelPath);
                assetManager.loadTextureAtlas(character.altAtlasPath);
            }
        });

        requestAnimationFrame(checkAllAssetsLoaded);
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
            isMouseHeld = true;
            console.log("Mouse left clicked on canvas at position:", mousePosition);
        }
    });

    canvas.addEventListener('mouseup', function (event) {
        if (event.button === 0) {
            isLeftMouseClicked = false;
            isMouseHeld = false;
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

    $("#autoMoveToggle").on("change", function () {
        const isChecked = $(this).is(":checked");
        console.log(`autoMoveToggle changed to: ${isChecked}`);
        Object.keys(skeletons).forEach(name => {
            if (name !== $("#playerCharacter").val() && !isDying[name]) {
                if (isChecked) {
                    if (!moveStates[name]) {
                        moveStates[name] = { isMoving: true, moveTime: 0, stopTime: 0, waitForAnimationEnd: false };
                    } else {
                        moveStates[name].isMoving = true;
                        moveStates[name].moveTime = 0;
                        moveStates[name].stopTime = 0;
                        moveStates[name].waitForAnimationEnd = false;
                    }
                    velocities[name].vx = (Math.random() - 0.5) * 150;
                    velocities[name].vy = (Math.random() - 0.5) * 150;
                    console.log(`autoMoveToggle enabled for ${name}, starting movement: vx=${velocities[name].vx}, vy=${velocities[name].vy}`);
                } else {
                    velocities[name].vx = 0;
                    velocities[name].vy = 0;
                    moveStates[name].isMoving = false;
                    moveStates[name].moveTime = 0;
                    moveStates[name].stopTime = 0;
                    moveStates[name].waitForAnimationEnd = false;
                    const character = skeletonData.find(c => c.name === name);
                    const targetAnim = (character && character.type === "operator") ? "Relax" : "Idle";
                    const animToUse = skeletons[name].skeleton.data.animations.find(anim => anim.name.toLowerCase() === targetAnim.toLowerCase())?.name || skeletons[name].skeleton.data.animations[0]?.name || "Idle";
                    skeletons[name].state.setAnimation(0, animToUse, true);
                    lastAnimation[name] = animToUse;
                    isInRelaxState[name] = animToUse.toLowerCase() === "relax";
                    console.log(`autoMoveToggle disabled for ${name}, switched to ${animToUse}`);
                }
            }
        });
    });

    $("#playerCharacter").on("change", function () {
        const selectedCharacter = $(this).val();
        if (!selectedCharacter || !skeletonNames.includes(selectedCharacter)) {
            console.warn("No valid character selected in playerCharacter dropdown.");
            return;
        }
        initializeSelectedCharacter();
    });
}

function checkAllAssetsLoaded() {
    if (assetManager.isLoadingComplete()) {
        console.log("All assets preloaded successfully, proceeding to setupUI...");
        $(document).ready(() => {
            console.log("Document ready, calling setupUI...");
            setupUI();
            const playerCharacterSelect = $("#playerCharacter");
            if (!playerCharacterSelect.length) {
                console.error("Dropdown with id 'playerCharacter' not found in DOM. Cannot attach change event.");
                return;
            }
            playerCharacterSelect.on("change", function () {
                const selectedCharacter = $(this).val();
                if (!selectedCharacter || !skeletonNames.includes(selectedCharacter)) {
                    console.warn("No valid character selected in playerCharacter dropdown.");
                    return;
                }
                initializeSelectedCharacter();
            });
        });
        requestAnimationFrame(render);
    } else {
        console.log("Waiting for assets to preload...");
        requestAnimationFrame(checkAllAssetsLoaded);
    }
}

function createAnimationListener(name) {
    return {
        start: function (track) {
            console.log("Animation on track " + track.trackIndex + " started: " + track.animation.name);
            if (name === $("#playerCharacter").val()) {
                if (track.animation.name.toLowerCase().includes("attack")) {
                    isAttacking = true;
                    isInAttackState[name] = true;
                    attackStartTime[name] = Date.now() / 1000;
                    console.log(`Set isAttacking to true for ${name}, isInAttackState: ${isInAttackState[name]}, stage: ${attackSequence[name].stage}`);
                }
            }
            if (track.animation.name.toLowerCase() === "die") {
                isDying[name] = true;
            }
            if (track.animation.name.toLowerCase() === "relax" || track.animation.name.toLowerCase() === "idle") {
                isInRelaxState[name] = true;
                isPlayingRandomAnimation[name] = false;
                moveStates[name].waitForAnimationEnd = true;
                console.log(`${name} - Entered Relax/Idle state, isInRelaxState: ${isInRelaxState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}, waitForAnimationEnd: ${moveStates[name].waitForAnimationEnd}`);
            }
        },
        interrupt: function (track) { console.log("Animation on track " + track.trackIndex + " interrupted"); },
        end: function (track) { console.log("Animation on track " + track.trackIndex + " ended"); },
        disposed: function (track) { console.log("Animation on track " + track.trackIndex + " disposed"); },
        complete: function (track) {
            console.log("Animation on track " + track.trackIndex + " completed: " + track.animation.name);
            const target = skeletons[name];
            if (target && name === $("#playerCharacter").val()) {
                const character = skeletonData.find(c => c.name === name);
                if (character && character.type === "operator") {
                    if (!isInAttackState[name] && !isDying[name] && (!velocities[name] || (velocities[name].vx === 0 && velocities[name].vy === 0))) {
                        if (track.animation.name.toLowerCase() === "relax" && !isPlayingRandomAnimation[name]) {
                            const availableAnimations = target.skeleton.data.animations
                                .filter(anim => !["default", "relax", "move"].includes(anim.name.toLowerCase()))
                                .map(anim => anim.name);
                            console.log(`${name} - Available animations for random selection: ${availableAnimations.join(", ")}`);
                            if (availableAnimations.length > 0) {
                                const randomAnim = availableAnimations[Math.floor(Math.random() * availableAnimations.length)];
                                target.state.setAnimation(0, randomAnim, false);
                                lastAnimation[name] = randomAnim;
                                isInRelaxState[name] = false;
                                isPlayingRandomAnimation[name] = true;
                                console.log(`${name} - Switched to random animation: ${randomAnim} after completing Relax, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                            } else {
                                console.warn(`${name} - No valid animations available for random selection, staying in Relax`);
                                const relaxAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "relax")?.name || "Idle";
                                target.state.setAnimation(0, relaxAnim, true);
                                lastAnimation[name] = relaxAnim;
                                isInRelaxState[name] = relaxAnim.toLowerCase() === "relax";
                                isPlayingRandomAnimation[name] = false;
                            }
                        } else if (isPlayingRandomAnimation[name]) {
                            const relaxAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "relax")?.name || "Idle";
                            target.state.setAnimation(0, relaxAnim, true);
                            lastAnimation[name] = relaxAnim;
                            isInRelaxState[name] = relaxAnim.toLowerCase() === "relax";
                            isPlayingRandomAnimation[name] = false;
                            console.log(`${name} - Returned to ${relaxAnim} after completing random animation ${track.animation.name}, isInRelaxState: ${isInRelaxState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                        }
                    }
                }
                if (track.animation.name.toLowerCase() === "attack_pre" || track.animation.name.toLowerCase() === "attack_begin") {
                    attackSequence[name].stage = "attack";
                    const attackAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack" || anim.name.toLowerCase() === "attack_loop")?.name;
                    if (attackAnim) {
                        target.state.setAnimation(0, attackAnim, false);
                        console.log(`${name} - Transitioned from ${track.animation.name} to ${attackAnim}`);
                    } else {
                        endAttackSequence(name, target, character);
                    }
                } else if (track.animation.name.toLowerCase() === "attack" || track.animation.name.toLowerCase() === "attack_loop") {
                    const attackEndAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack_end")?.name;
                    if (attackEndAnim) {
                        attackSequence[name].stage = "attack_end";
                        target.state.setAnimation(0, attackEndAnim, false);
                        console.log(`${name} - Transitioned from ${track.animation.name} to Attack_End`);
                    } else {
                        endAttackSequence(name, target, character);
                    }
                } else if (track.animation.name.toLowerCase() === "attack_end") {
                    endAttackSequence(name, target, character);
                }
            } else if (track.animation.name.toLowerCase() === "die") {
                console.log(`${name} Die animation completed, removing character`);
                delete skeletons[name];
                delete velocities[name];
                delete health[name];
                delete isDying[name];
                delete isInRelaxState[name];
                delete attackStartTime[name];
                delete isInAttackState[name];
                delete isPlayingRandomAnimation[name];
                delete attackSequence[name];
                delete moveStates[name];
                if (Object.keys(skeletons).length === 0) {
                    $("#playerCharacter").trigger("change");
                }
            } else if ((track.animation.name.toLowerCase() === "idle" || track.animation.name.toLowerCase() === "relax") && moveStates[name].waitForAnimationEnd) {
                moveStates[name].isMoving = true;
                moveStates[name].moveTime = 0;
                moveStates[name].waitForAnimationEnd = false;
                velocities[name].vx = (Math.random() - 0.5) * 150;
                velocities[name].vy = (Math.random() - 0.5) * 150;
                console.log(`Animation ${track.animation.name} completed for ${name}, resumed movement: vx=${velocities[name].vx}, vy=${velocities[name].vy}`);
            }
        },
        event: function (track, event) {
            console.log("Event on track " + track.trackIndex + " at time " + event.time + ": " + event.data.name);
            if (event.data.name === "OnAttack" && name === $("#playerCharacter").val()) {
                console.log(`Processing OnAttack event for ${name} at time ${event.time}`);
                const hitboxes = Object.keys(skeletons).map(n => {
                    const skeleton = skeletons[n]?.skeleton;
                    return { name: n, x: skeleton.x, y: skeleton.y, radius: 50, skeleton };
                });

                const playerAttackHitbox = attackHitboxes.find(h => h.name === name);
                if (playerAttackHitbox) {
                    hitboxes.forEach(hitbox => {
                        if (hitbox.name === name) return;
                        const dx = hitbox.x - playerAttackHitbox.skeleton.x;
                        const dy = hitbox.y - playerAttackHitbox.skeleton.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const attackRangeExtension = 30;
                        const effectiveAttackRadius = playerAttackHitbox.radius + attackRangeExtension;
                        console.log(`Checking collision: ${name} vs ${hitbox.name}, dist: ${dist}, threshold: ${effectiveAttackRadius}`);
                        if (dist < effectiveAttackRadius) {
                            const angleToTarget = Math.atan2(-dy, dx) * (180 / Math.PI);
                            const { worldX: mouseWorldX, worldY: mouseWorldY } = screenToWorld(mousePosition.x, mousePosition.y);
                            const dxMouse = mouseWorldX - playerAttackHitbox.skeleton.x;
                            const dyMouse = mouseWorldY - playerAttackHitbox.skeleton.y;
                            const angleToMouse = Math.atan2(-dyMouse, dxMouse) * (180 / Math.PI);
                            const angleDiff = Math.abs(angleToTarget - angleToMouse);
                            const normalizedAngleDiff = Math.min(angleDiff, 360 - angleDiff);
                            console.log(`Angle check: angleToTarget=${angleToTarget}, angleToMouse=${angleToMouse}, normalizedAngleDiff=${normalizedAngleDiff}`);
                            if (normalizedAngleDiff <= 45) {
                                if (health[hitbox.name] > 0) {
                                    health[hitbox.name] -= 25;
                                    console.log(`Đã tấn công ${hitbox.name}! Máu còn lại: ${health[hitbox.name]}`);
                                    if (health[hitbox.name] <= 0) {
                                        console.log(`${hitbox.name} đã hết máu, kiểm tra animation Die`);
                                        const targetSkeleton = skeletons[hitbox.name];
                                        if (targetSkeleton) {
                                            const character = skeletonData.find(c => c.name === hitbox.name);
                                            const isOperator = character && character.type === "operator";
                                            const { state, skeleton } = targetSkeleton;

                                            if (isOperator && character.skelPath && character.atlasPath) {
                                                console.log(`Switching ${hitbox.name} to skelPath to play Die animation`);
                                                switchSkeletonFile(hitbox.name, character.skelPath, character.atlasPath, "Die", (success) => {
                                                    if (success) {
                                                        const dieAnimation = skeletons[hitbox.name].skeleton.data.animations.find(anim => anim.name.toLowerCase() === "die")?.name;
                                                        if (dieAnimation) {
                                                            console.log(`Chuyển ${hitbox.name} sang animation Die sau khi chuyển skeleton`);
                                                            skeletons[hitbox.name].state.setAnimation(0, dieAnimation, false);
                                                        } else {
                                                            console.warn(`No Die animation found in skelPath for ${hitbox.name}, removing immediately`);
                                                            removeCharacter(hitbox.name);
                                                        }
                                                    } else {
                                                        console.error(`Failed to switch to skelPath for ${hitbox.name}, removing immediately`);
                                                        removeCharacter(hitbox.name);
                                                    }
                                                });
                                            } else {
                                                const dieAnimation = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "die")?.name;
                                                if (dieAnimation) {
                                                    console.log(`Chuyển ${hitbox.name} sang animation Die`);
                                                    state.setAnimation(0, dieAnimation, false);
                                                } else {
                                                    console.warn(`No Die animation for ${hitbox.name}, removing immediately`);
                                                    removeCharacter(hitbox.name);
                                                }
                                            }
                                        } else {
                                            console.error(`Skeleton for ${hitbox.name} not found during OnAttack`);
                                        }
                                    }
                                }
                            }
                        }
                    });
                } else {
                    console.warn(`No attack hitbox found for ${name} during OnAttack event`);
                }
                hasTriggeredAttack = true;
            }
        }
    };
}

function cleanupCharacter(name) {
    if (!name) return;
    delete skeletons[name];
    delete velocities[name];
    delete health[name];
    delete isDying[name];
    delete isInRelaxState[name];
    delete attackStartTime[name];
    delete isInAttackState[name];
    delete isPlayingRandomAnimation[name];
    delete attackSequence[name];
    delete moveStates[name];
    attackHitboxes = attackHitboxes.filter(h => h.name !== name);
    isAttacking = false;
    isLeftMouseClicked = false;
    console.log(`Cleaned up character: ${name}`);
}

function removeCharacter(name) {
    delete skeletons[name];
    delete velocities[name];
    delete health[name];
    delete isDying[name];
    delete isInRelaxState[name];
    delete attackStartTime[name];
    delete isInAttackState[name];
    delete isPlayingRandomAnimation[name];
    delete attackSequence[name];
    delete moveStates[name];
    if (Object.keys(skeletons).length === 0) {
        $("#playerCharacter").trigger("change");
    }
}

function endAttackSequence(name, target, character) {
    isAttacking = false;
    isInAttackState[name] = false;
    attackHitboxes = [];
    delete attackStartTime[name];
    attackSequence[name].stage = null;
    console.log(`Attack sequence ended for ${name}, isInAttackState: ${isInAttackState[name]}, cleared all hitboxes`);
    refreshCanvas();

    let defaultAnim = "Idle";
    if (character && character.type === "operator" && character.altSkelPath && character.altAtlasPath) {
        switchSkeletonFile(name, character.altSkelPath, character.altAtlasPath, defaultAnim, (success) => {
            console.log(`Switched ${name} back to ${defaultAnim} after attack sequence, success: ${success}`);
        });
    }
    try {
        const relaxAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "relax")?.name;
        const animToUse = relaxAnim || defaultAnim;
        target.state.setAnimation(0, animToUse, true);
        lastAnimation[name] = animToUse;
        isInRelaxState[name] = animToUse.toLowerCase() === "relax";
        isPlayingRandomAnimation[name] = false;
        console.log(`Successfully switched ${name} back to animation: ${animToUse}, isInRelaxState: ${isInRelaxState[name]}`);
    } catch (e) {
        console.error(`Failed to switch animation for ${name} to ${defaultAnim}: ${e.message}`);
        const fallbackAnim = target.skeleton.data.animations[0]?.name || "Idle";
        target.state.setAnimation(0, fallbackAnim, true);
        lastAnimation[name] = fallbackAnim;
        isInRelaxState[name] = fallbackAnim.toLowerCase() === "relax";
        isPlayingRandomAnimation[name] = false;
        console.log(`Switched ${name} to fallback animation: ${fallbackAnim}, isInRelaxState: ${isInRelaxState[name]}`);
    }
}

function loadSkeleton(name, initialAnimation, premultipliedAlpha, skin, data, skelPath, atlasPath) {
    if (skin === undefined) skin = "default";

    const character = data.find(c => c.name === name);
    if (!character) {
        console.error(`Character ${name} not found in data`);
        return null;
    }

    const isOperator = character.type === "operator";
    const skelPathToUse = skelPath || (isOperator && character.altSkelPath ? character.altSkelPath : character.skelPath);
    const atlasPathToUse = atlasPath || (isOperator && character.altAtlasPath ? character.altAtlasPath : character.atlasPath);

    let atlas = null;
    try {
        atlas = assetManager.get(atlasPathToUse);
        if (!atlas) {
            console.error(`Atlas not loaded for ${atlasPathToUse}`);
            return null;
        }
    } catch (e) {
        console.error(`Failed to load atlas for ${atlasPathToUse}: ${e.message}`);
        return null;
    }

    let skeletonDataLocal = null;
    try {
        const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
        const skeletonBinary = new spine.SkeletonBinary(atlasLoader);
        skeletonBinary.scale = 0.5;

        const binaryData = assetManager.get(skelPathToUse);
        if (!binaryData) {
            console.error(`Skeleton binary not loaded for ${skelPathToUse}`);
            return null;
        }

        skeletonDataLocal = skeletonBinary.readSkeletonData(binaryData);
        if (!skeletonDataLocal) {
            console.error(`Failed to parse skeleton data from ${skelPathToUse}`);
            return null;
        }

        if (!skeletonDataLocal.bones || !skeletonDataLocal.bones.length || !skeletonDataLocal.slots.length || !skeletonDataLocal.skins.length) {
            console.error(`Invalid skeleton data for ${name}: No bones, slots, or skins`);
            return null;
        }
        if (!skeletonDataLocal.animations || !skeletonDataLocal.animations.length) {
            console.error(`No animations found in skeleton data for ${name}`);
            return null;
        }
    } catch (e) {
        console.error(`Failed to read skeleton data for ${skelPathToUse}: ${e.message}`);
        return null;
    }

    const skeleton = new spine.Skeleton(skeletonDataLocal);
    skeleton.setSkinByName(skin);
    const bounds = calculateSetupPoseBounds(skeleton);

    if (!bounds || isNaN(bounds.size.x) || isNaN(bounds.size.y)) {
        console.error(`Invalid bounds for ${name}: size.x=${bounds?.size.x}, size.y=${bounds?.size.y}`);
        return null;
    }

    const animationStateData = new spine.AnimationStateData(skeleton.data);
    const animationState = new spine.AnimationState(animationStateData);

    const animationToUse = skeleton.data.animations.find(anim => anim.name.toLowerCase() === initialAnimation.toLowerCase())?.name || skeleton.data.animations[0]?.name;
    if (!animationToUse) {
        console.error(`No valid animation found for ${name}`);
        return null;
    }
    animationState.setAnimation(0, animationToUse, true);

    animationState.addListener(createAnimationListener(name));

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

function switchSkeletonFile(name, newSkelPath, newAtlasPath, initialAnimation, callback) {
    if (!skeletons[name]) {
        console.error(`Character ${name} not found`);
        if (callback) callback(false);
        return false;
    }

    let skelData = assetManager.get(newSkelPath);
    let atlasData = assetManager.get(newAtlasPath);
    console.log(`Debug - skelData for ${newSkelPath}:`, skelData);
    console.log(`Debug - atlasData for ${newAtlasPath}:`, atlasData);
    if (!skelData || !atlasData) {
        console.warn(`Assets for ${newSkelPath} or ${newAtlasPath} not preloaded, attempting to load now...`);
        assetManager.loadBinary(newSkelPath);
        assetManager.loadTextureAtlas(newAtlasPath);
    }

    let retryCount = 0;
    const maxRetries = 10;
    function attemptSwitch() {
        if (retryCount >= maxRetries) {
            console.error(`Failed to load assets for ${newSkelPath} after ${maxRetries} retries`);
            if (callback) callback(false);
            return;
        }

        skelData = assetManager.get(newSkelPath);
        atlasData = assetManager.get(newAtlasPath);
        if (skelData && atlasData && assetManager.isLoadingComplete()) {
            try {
                const atlas = atlasData;
                if (!atlas) {
                    console.error(`Atlas not loaded for ${newAtlasPath}`);
                    if (callback) callback(false);
                    return;
                }
                const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
                const skeletonBinary = new spine.SkeletonBinary(atlasLoader);
                skeletonBinary.scale = 0.5;

                const binaryData = skelData;
                if (!binaryData) {
                    console.error(`Skeleton binary not loaded for ${newSkelPath}`);
                    if (callback) callback(false);
                    return;
                }
                const newSkeletonData = skeletonBinary.readSkeletonData(binaryData);
                if (!newSkeletonData) {
                    console.error(`Failed to parse skeleton data from ${newSkelPath}`);
                    if (callback) callback(false);
                    return;
                }

                const oldSkeleton = skeletons[name].skeleton;
                const oldX = oldSkeleton.x;
                const oldY = oldSkeleton.y;
                const oldScaleX = oldSkeleton.scaleX;
                const oldScaleY = oldSkeleton.scaleY;

                const newSkeleton = new spine.Skeleton(newSkeletonData);
                newSkeleton.setSkinByName("default");
                newSkeleton.x = oldX;
                newSkeleton.y = oldY;
                newSkeleton.scaleX = oldScaleX;
                newSkeleton.scaleY = oldScaleY;
                newSkeleton.setToSetupPose();

                const animationStateData = new spine.AnimationStateData(newSkeletonData);
                const animationState = new spine.AnimationState(animationStateData);
                const animationToUse = newSkeletonData.animations.find(anim => anim.name.toLowerCase() === initialAnimation.toLowerCase())?.name || newSkeletonData.animations[0]?.name;
                if (!animationToUse) {
                    console.error(`No valid animation found in ${newSkelPath} for ${initialAnimation}`);
                    if (callback) callback(false);
                    return;
                }
                console.log(`Setting animation ${animationToUse} for ${name} with loop: ${initialAnimation.toLowerCase() !== "attack" && initialAnimation.toLowerCase() !== "attack_begin" && initialAnimation.toLowerCase() !== "attack_loop"}`);
                animationState.setAnimation(0, animationToUse, initialAnimation.toLowerCase() !== "attack" && initialAnimation.toLowerCase() !== "attack_begin" && initialAnimation.toLowerCase() !== "attack_loop");

                animationState.addListener(createAnimationListener(name));

                if (name === $("#playerCharacter").val()) {
                    isAttacking = false;
                    isInAttackState[name] = false;
                    attackHitboxes = [];
                    delete attackStartTime[name];
                    lastAnimation[name] = animationToUse;
                    isPlayingRandomAnimation[name] = false;
                    isInRelaxState[name] = animationToUse.toLowerCase() === "relax";
                    attackSequence[name] = { stage: null };
                    console.log(`After switching skeleton file for ${name}, set isInRelaxState: ${isInRelaxState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                }

                skeletons[name] = { skeleton: newSkeleton, state: animationState, bounds: calculateSetupPoseBounds(newSkeleton), premultipliedAlpha: skeletons[name]?.premultipliedAlpha || false };
                console.log(`Successfully switched ${name} to new skeleton file: ${newSkelPath} with animation ${animationState.tracks[0]?.animation?.name}`);
                if (callback) callback(true);
            } catch (e) {
                console.error(`Error switching skeleton file for ${name}: ${e.message}`);
                if (callback) callback(false);
            }
        } else {
            console.warn(`Assets for ${newSkelPath} not yet loaded, retrying... (attempt ${retryCount + 1}/${maxRetries})`);
            retryCount++;
            requestAnimationFrame(attemptSwitch);
        }
    }

    attemptSwitch();
    return true;
}

// Hàm chuyển đổi tọa độ từ thế giới sang màn hình, sửa trục Y
function worldToScreen(x, y) {
    const screenX = (x - camera.x) * camera.zoom + canvas.width / 2;
    const screenY = canvas.height - ((y - camera.y) * camera.zoom + canvas.height / 2); // Đảo ngược trục Y
    return { screenX, screenY };
}

// Hàm chuyển đổi tọa độ từ màn hình sang thế giới
function screenToWorld(screenX, screenY) {
    const worldX = (screenX - canvas.width / 2) / camera.zoom + camera.x;
    const worldY = camera.y + (canvas.height - screenY - canvas.height / 2) / camera.zoom; // Đảo ngược trục Y
    return { worldX, worldY };
}

function render() {
    var now = Date.now() / 1000;
    var delta = Math.min(0.1, now - lastFrameTime);
    lastFrameTime = now;

    resize();

    gl.clearColor(0.3, 0.3, 0.3, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    try {
        if (batcher.isDrawing) {
            batcher.end();
            console.log("Forced batcher.end() to resolve drawing state");
        }
    } catch (e) {
        console.warn("Error checking batcher state:", e.message);
    }

    shader.bind();
    shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
    shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, mvp.values);
    batcher.begin(shader);

    // Cập nhật vị trí camera để theo dõi nhân vật chính
    const playerName = $("#playerCharacter").val();
    if (skeletons[playerName]) {
        const playerSkeleton = skeletons[playerName].skeleton;
        camera.x = playerSkeleton.x;
        camera.y = playerSkeleton.y;
    }

    const sortedSkeletons = Object.keys(skeletons).map(name => ({
        name,
        y: skeletons[name].skeleton.y
    })).sort((a, b) => b.y - a.y);

    hitboxCtx.clearRect(0, 0, hitboxCanvas.width, hitboxCanvas.height);

    const hitboxes = [];
    attackHitboxes = []; // Xóa hitbox cũ trước khi cập nhật

    sortedSkeletons.forEach(({ name }) => {
        const target = skeletons[name];
        if (!target) {
            console.error(`Skeleton for ${name} is undefined, skipping render`);
            return;
        }
        const { skeleton, state, bounds, premultipliedAlpha } = target;
        const currentAnimation = state.tracks[0]?.animation?.name || skeleton.data.animations[0]?.name;
        console.log(`Current animation for ${name}: ${currentAnimation}, isAttacking: ${isAttacking}, isInAttackState: ${isInAttackState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);

        if (isInAttackState[name] && attackStartTime[name] && (now - attackStartTime[name]) > (ATTACK_TIMEOUT / 1000)) {
            console.warn(`Attack sequence for ${name} timed out after ${ATTACK_TIMEOUT}ms`);
            const character = skeletonData.find(c => c.name === name);
            endAttackSequence(name, target, character);
        }

        if (isNaN(skeleton.x) || isNaN(skeleton.y)) {
            console.error(`Invalid coordinates for ${name}: x=${skeleton.x}, y=${skeleton.y}, skipping hitbox`);
            return;
        }

        const baseRadius = 50;
        const current = { name, x: skeleton.x, y: skeleton.y, radius: baseRadius, skeleton };
        hitboxes.push(current);

        if (name === $("#playerCharacter").val()) {
            let vx = 0, vy = 0, speed = 100;
            const margin = 50;
            if (!isInAttackState[name] && !isDying[name]) {
                if (keys['ArrowLeft'] || keys['KeyA']) { vx = -speed; skeleton.scaleX = -1; }
                if (keys['ArrowRight'] || keys['KeyD']) { vx = speed; skeleton.scaleX = 1; }
                if (keys['ArrowUp'] || keys['KeyW']) vy = speed;
                if (keys['ArrowDown'] || keys['KeyS']) vy = -speed;

                skeleton.x += vx * delta;
                skeleton.y += vy * delta;

                skeleton.x = Math.max(margin + bounds.size.x / 2, Math.min(WORLD_WIDTH - margin - bounds.size.x / 2, skeleton.x));
                skeleton.y = Math.max(margin + bounds.size.y / 2, Math.min(WORLD_HEIGHT - margin - bounds.size.y / 2, skeleton.y));

                if (!isInAttackState[name]) {
                    const idleAnim = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "idle")?.name || skeleton.data.animations[0]?.name || "Idle";
                    const character = skeletonData.find(c => c.name === name);
                    if (character && character.type === "operator") {
                        if (!isPlayingRandomAnimation[name]) {
                            const targetAnim = (vx !== 0 || vy !== 0) ? "Move" : "Relax";
                            if (lastAnimation[name] !== targetAnim) {
                                state.setAnimation(0, targetAnim, true);
                                lastAnimation[name] = targetAnim;
                                isInRelaxState[name] = targetAnim.toLowerCase() === "relax";
                                console.log(`${name} - Switched to animation: ${targetAnim}, isInRelaxState: ${isInRelaxState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                            }
                        }
                        if (vx === 0 && vy === 0) {
                            idleTime[name] += delta;
                            if (isInRelaxState[name]) {
                                console.log(`${name} - In Relax state, waiting for Relax animation to complete, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                            }
                        } else {
                            idleTime[name] = 0;
                            isPlayingRandomAnimation[name] = false;
                            console.log(`${name} - Moving, resetting timers, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                        }
                    } else {
                        const targetAnim = (vx !== 0 || vy !== 0) ? "Move" : idleAnim;
                        if (lastAnimation[name] !== targetAnim) {
                            state.setAnimation(0, targetAnim, true);
                            lastAnimation[name] = targetAnim;
                            console.log(`Switched to animation: ${targetAnim}`);
                        }
                    }
                }
            } else {
                console.log(`Movement blocked for ${name} during Attack, isInAttackState: ${isInAttackState[name]}`);
            }

            if (isLeftMouseClicked && !isInAttackState[name] && !isDying[name]) {
                let character;
                if (Array.isArray(skeletonData)) {
                    character = skeletonData.find(c => c.name === name);
                } else {
                    console.warn(`skeletonData is not an array for ${name}, skipping character lookup`);
                    character = null;
                }
                lastAnimation[name] = currentAnimation || "Idle";
                isPlayingRandomAnimation[name] = false;
                if (character && character.type === "operator" && character.skelPath && character.atlasPath) {
                    console.log(`Switching ${name} to skelPath for Attack animation, skelPath: ${character.skelPath}, atlasPath: ${character.atlasPath}`);
                    const initialAttackAnim = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack_begin")?.name || "attack_pre";
                    switchSkeletonFile(name, character.skelPath, character.atlasPath, initialAttackAnim, (success) => {
                        const target = skeletons[name];
                        if (target) {
                            if (success) {
                                const attackPreAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack_pre")?.name;
                                const attackBeginAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack_begin")?.name;
                                const attackAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack" || anim.name.toLowerCase() === "attack_loop")?.name;
                                if (attackBeginAnim) {
                                    attackSequence[name].stage = "attack_begin";
                                    target.state.setAnimation(0, attackBeginAnim, false);
                                    isInAttackState[name] = true;
                                    attackStartTime[name] = Date.now() / 1000;
                                    console.log(`Started Attack_Begin for ${name}, available animations: ${target.skeleton.data.animations.map(a => a.name).join(", ")}`);
                                } else if (attackPreAnim) {
                                    attackSequence[name].stage = "attack_pre";
                                    target.state.setAnimation(0, attackPreAnim, false);
                                    isInAttackState[name] = true;
                                    attackStartTime[name] = Date.now() / 1000;
                                    console.log(`Started Attack_Pre for ${name}, available animations: ${target.skeleton.data.animations.map(a => a.name).join(", ")}`);
                                } else if (attackAnim) {
                                    attackSequence[name].stage = "attack";
                                    target.state.setAnimation(0, attackAnim, false);
                                    isInAttackState[name] = true;
                                    attackStartTime[name] = Date.now() / 1000;
                                    console.log(`Started ${attackAnim} for ${name} (no Attack_Pre or Attack_Begin), available animations: ${target.skeleton.data.animations.map(a => a.name).join(", ")}`);
                                } else {
                                    console.error(`No Attack, Attack_Pre, or Attack_Begin animation found for ${name}, available animations: ${target.skeleton.data.animations.map(a => a.name).join(", ")}`);
                                    isInAttackState[name] = false;
                                    endAttackSequence(name, target, character);
                                }
                            } else {
                                console.error(`Failed to switch skeleton file for ${name}, check asset loading`);
                                isInAttackState[name] = false;
                                endAttackSequence(name, target, character);
                            }
                        } else {
                            console.error(`Target skeleton for ${name} not found after switching file`);
                            isInAttackState[name] = false;
                        }
                        isLeftMouseClicked = false;
                        hasTriggeredAttack = false;
                    });
                } else {
                    const attackBeginAnim = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack_begin")?.name;
                    const attackPreAnim = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack_pre")?.name;
                    const attackAnim = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack" || anim.name.toLowerCase() === "attack_loop")?.name;
                    if (attackBeginAnim) {
                        attackSequence[name].stage = "attack_begin";
                        try {
                            state.setAnimation(0, attackBeginAnim, false);
                            isInAttackState[name] = true;
                            attackStartTime[name] = Date.now() / 1000;
                            console.log(`Triggered Attack_Begin animation for ${name} without switching file, previous animation: ${lastAnimation[name]}`);
                        } catch (e) {
                            console.error(`Failed to set Attack_Begin animation for ${name}: ${e.message}`);
                            isInAttackState[name] = false;
                        }
                    } else if (attackPreAnim) {
                        attackSequence[name].stage = "attack_pre";
                        try {
                            state.setAnimation(0, attackPreAnim, false);
                            isInAttackState[name] = true;
                            attackStartTime[name] = Date.now() / 1000;
                            console.log(`Triggered Attack_Pre animation for ${name} without switching file, previous animation: ${lastAnimation[name]}`);
                        } catch (e) {
                            console.error(`Failed to set Attack_Pre animation for ${name}: ${e.message}`);
                            isInAttackState[name] = false;
                        }
                    } else if (attackAnim) {
                        attackSequence[name].stage = "attack";
                        try {
                            state.setAnimation(0, attackAnim, false);
                            isInAttackState[name] = true;
                            attackStartTime[name] = Date.now() / 1000;
                            console.log(`Triggered ${attackAnim} animation for ${name} without switching file, previous animation: ${lastAnimation[name]}`);
                        } catch (e) {
                            console.error(`Failed to set ${attackAnim} animation for ${name}: ${e.message}`);
                            isInAttackState[name] = false;
                        }
                    } else {
                        console.warn(`No Attack, Attack_Pre, or Attack_Begin animation available for ${name} in current skeleton, available animations: ${skeleton.data.animations.map(a => a.name).join(", ")}`);
                        isInAttackState[name] = false;
                    }
                    isLeftMouseClicked = false;
                    hasTriggeredAttack = false;
                }
            } else if (isLeftMouseClicked) {
                console.log(`Cannot trigger Attack for ${name}. Current state: isInAttackState=${isInAttackState[name]}, isDying=${isDying[name]}`);
                isLeftMouseClicked = false;
            }

            if (isInAttackState[name]) {
                const { worldX: mouseWorldX, worldY: mouseWorldY } = screenToWorld(mousePosition.x, mousePosition.y);
                const dx = mouseWorldX - skeleton.x;
                const dy = mouseWorldY - skeleton.y;
                skeleton.scaleX = dx >= 0 ? 1 : -1;

                const attackRadius = 100;
                const attackRangeExtension = 30;
                const attackHitboxX = skeleton.x;
                const attackHitboxY = skeleton.y;

                const attackHitbox = { name, x: attackHitboxX, y: attackHitboxY, radius: attackRadius, skeleton };
                attackHitboxes.push(attackHitbox);

                if (showHitbox) {
                    const { screenX, screenY } = worldToScreen(skeleton.x, skeleton.y);
                    hitboxCtx.strokeStyle = "rgba(255, 165, 0, 0.8)";
                    hitboxCtx.fillStyle = "rgba(255, 165, 0, 0.3)";
                    hitboxCtx.beginPath();
                    const angleToMouse = Math.atan2(-dy, dx);
                    const startAngle = angleToMouse - Math.PI / 4;
                    const endAngle = angleToMouse + Math.PI / 4;
                    const effectiveAttackRadius = (attackRadius + attackRangeExtension) * camera.zoom;
                    hitboxCtx.arc(screenX, screenY, effectiveAttackRadius, startAngle, endAngle);
                    hitboxCtx.fill();
                    hitboxCtx.stroke();
                    console.log(`Drawing attack hitbox for ${name}: x=${screenX}, y=${screenY}, radius=${effectiveAttackRadius}, angle=${angleToMouse * (180 / Math.PI)}`);
                }
            } else {
                if (attackHitboxes.some(h => h.name === name)) {
                    console.log(`Cleared lingering attack hitboxes for ${name} as not in Attack state`);
                    attackHitboxes = attackHitboxes.filter(h => h.name !== name);
                }
            }
        } else {
            if (!isDying[name]) {
                if ($("#autoMoveToggle").is(":checked")) {
                    const character = skeletonData.find(c => c.name === name);
                    const targetAnimMove = "Move";
                    const targetAnimIdle = (character && character.type === "operator") ? "Relax" : "Idle";
                    const animToUseIdle = skeleton.data.animations.find(anim => anim.name.toLowerCase() === targetAnimIdle.toLowerCase())?.name || skeleton.data.animations[0]?.name || "Idle";

                    if (!moveStates[name]) {
                        moveStates[name] = { isMoving: true, moveTime: 0, stopTime: 0, waitForAnimationEnd: false };
                        velocities[name].vx = (Math.random() - 0.5) * 150;
                        velocities[name].vy = (Math.random() - 0.5) * 150;
                        console.log(`Initialized moveStates for ${name} with movement: vx=${velocities[name].vx}, vy=${velocities[name].vy}`);
                    }

                    const moveState = moveStates[name];

                    if (moveState.isMoving) {
                        moveState.moveTime += delta;
                        const maxMoveDuration = 5 + Math.random() * 5;

                        if (moveState.moveTime >= maxMoveDuration) {
                            moveState.isMoving = false;
                            moveState.moveTime = 0;
                            moveState.waitForAnimationEnd = true;
                            velocities[name].vx = 0;
                            velocities[name].vy = 0;
                            if (currentAnimation.toLowerCase() !== animToUseIdle.toLowerCase()) {
                                state.setAnimation(0, animToUseIdle, true);
                                lastAnimation[name] = animToUseIdle;
                                isInRelaxState[name] = animToUseIdle.toLowerCase() === "relax";
                                console.log(`Switched ${name} to ${animToUseIdle} after moving, waiting for animation end`);
                            }
                        } else {
                            if (Math.random() < 0.01) {
                                velocities[name].vx = (Math.random() - 0.5) * 150;
                                velocities[name].vy = (Math.random() - 0.5) * 150;
                                console.log(`Random velocity change for ${name}: vx=${velocities[name].vx}, vy=${velocities[name].vy}`);
                            }

                            const margin = 50;
                            const prevX = skeleton.x;
                            const prevY = skeleton.y;
                            skeleton.x += velocities[name].vx * delta;
                            skeleton.y += velocities[name].vy * delta;

                            skeleton.x = Math.max(margin + bounds.size.x / 2, Math.min(WORLD_WIDTH - margin - bounds.size.x / 2, skeleton.x));
                            skeleton.y = Math.max(margin + bounds.size.y / 2, Math.min(WORLD_HEIGHT - margin - bounds.size.y / 2, skeleton.y));

                            if (skeleton.x === margin + bounds.size.x / 2 && prevX < skeleton.x) velocities[name].vx = -Math.abs(velocities[name].vx);
                            if (skeleton.x === WORLD_WIDTH - margin - bounds.size.x / 2 && prevX > skeleton.x) velocities[name].vx = Math.abs(velocities[name].vx);
                            if (skeleton.y === margin + bounds.size.y / 2 && prevY < skeleton.y) velocities[name].vy = -Math.abs(velocities[name].vy);
                            if (skeleton.y === WORLD_HEIGHT - margin - bounds.size.y / 2 && prevY > skeleton.y) velocities[name].vy = Math.abs(velocities[name].vy);

                            if (velocities[name].vx > 0) skeleton.scaleX = 1;
                            else if (velocities[name].vx < 0) skeleton.scaleX = -1;

                            if (currentAnimation.toLowerCase() !== targetAnimMove.toLowerCase()) {
                                state.setAnimation(0, targetAnimMove, true);
                                lastAnimation[name] = targetAnimMove;
                                isInRelaxState[name] = false;
                                console.log(`Switched ${name} to Move animation due to auto movement`);
                            }
                        }
                    } else if (moveState.waitForAnimationEnd) {
                        console.log(`${name} - Waiting for ${currentAnimation} to complete before resuming movement`);
                    } else {
                        moveState.isMoving = true;
                        moveState.moveTime = 0;
                        velocities[name].vx = (Math.random() - 0.5) * 150;
                        velocities[name].vy = (Math.random() - 0.5) * 150;
                        console.log(`Restarted movement for ${name} after idle: vx=${velocities[name].vx}, vy=${velocities[name].vy}`);
                    }

                    if (velocities[name].vx === 0 && velocities[name].vy === 0) {
                        idleTime[name] += delta;
                        console.log(`Idle time for ${name} (other): ${idleTime[name]}s`);
                    } else {
                        idleTime[name] = 0;
                    }
                } else {
                    velocities[name].vx = 0;
                    velocities[name].vy = 0;
                    const character = skeletonData.find(c => c.name === name);
                    const targetAnim = (character && character.type === "operator") ? "Relax" : "Idle";
                    const animToUse = skeleton.data.animations.find(anim => anim.name.toLowerCase() === targetAnim.toLowerCase())?.name || skeleton.data.animations[0]?.name || "Idle";
                    if (currentAnimation.toLowerCase() !== animToUse.toLowerCase()) {
                        state.setAnimation(0, animToUse, true);
                        lastAnimation[name] = animToUse;
                        isInRelaxState[name] = animToUse.toLowerCase() === "relax";
                        console.log(`Switched ${name} to ${animToUse} animation due to auto movement being off, isInRelaxState: ${isInRelaxState[name]}`);
                    }
                    idleTime[name] += delta;
                    console.log(`Idle time for ${name} (other): ${idleTime[name]}s`);
                }
            }
        }

        current.x = skeleton.x;
        current.y = skeleton.y;

        state.update(delta);
        state.apply(skeleton);
        skeleton.updateWorldTransform();

        // Chuyển đổi tọa độ thế giới sang tọa độ màn hình để vẽ nhân vật
        const { screenX, screenY } = worldToScreen(skeleton.x, skeleton.y);
        skeleton.x = screenX;
        skeleton.y = screenY;

        skeletonRenderer.vertexEffect = null;
        skeletonRenderer.premultipliedAlpha = premultipliedAlpha;
        skeletonRenderer.draw(batcher, skeleton);

        // Khôi phục tọa độ thế giới sau khi vẽ
        skeleton.x = current.x;
        skeleton.y = current.y;
    });

    hitboxes.forEach((hitboxA, indexA) => {
        hitboxes.forEach((hitboxB, indexB) => {
            if (indexA === indexB) return;
            if (!skeletons[hitboxA.name] || !skeletons[hitboxB.name]) {
                console.warn(`Skeleton missing for ${hitboxA.name} or ${hitboxB.name}, skipping collision check`);
                return;
            }
            if (isNaN(hitboxA.x) || isNaN(hitboxA.y) || isNaN(hitboxB.x) || isNaN(hitboxB.y)) {
                console.warn(`Invalid coordinates for collision check: ${hitboxA.name} (x=${hitboxA.x}, y=${hitboxA.y}), ${hitboxB.name} (x=${hitboxB.x}, y=${hitboxB.y})`);
                return;
            }
            const dx = hitboxB.x - hitboxA.x;
            const dy = hitboxB.y - hitboxA.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = hitboxA.radius + hitboxB.radius;

            if (dist < minDist) {
                if (dist > 0) {
                    const overlap = minDist - dist;
                    const adjustX = (overlap * dx / dist) / 2;
                    const adjustY = (overlap * dy / dist) / 2;

                    skeletons[hitboxA.name].skeleton.x -= adjustX;
                    skeletons[hitboxA.name].skeleton.y -= adjustY;
                    skeletons[hitboxB.name].skeleton.x += adjustX;
                    skeletons[hitboxB.name].skeleton.y += adjustY;

                    console.log(`Collision detected between ${hitboxA.name} and ${hitboxB.name}, adjusted positions`);
                } else {
                    console.warn(`Characters ${hitboxA.name} and ${hitboxB.name} are overlapping at the same position, separating them`);
                    const separationDistance = minDist / 2;
                    const adjustX = separationDistance * (Math.random() - 0.5);
                    const adjustY = separationDistance * (Math.random() - 0.5);

                    skeletons[hitboxA.name].skeleton.x -= adjustX;
                    skeletons[hitboxA.name].skeleton.y -= adjustY;
                    skeletons[hitboxB.name].skeleton.x += adjustX;
                    skeletons[hitboxB.name].skeleton.y += adjustY;

                    const boundsA = skeletons[hitboxA.name].bounds;
                    const boundsB = skeletons[hitboxB.name].bounds;
                    const margin = 50;
                    skeletons[hitboxA.name].skeleton.x = Math.max(margin + boundsA.size.x / 2, Math.min(WORLD_WIDTH - margin - boundsA.size.x / 2, skeletons[hitboxA.name].skeleton.x));
                    skeletons[hitboxA.name].skeleton.y = Math.max(margin + boundsA.size.y / 2, Math.min(WORLD_HEIGHT - margin - boundsA.size.y / 2, skeletons[hitboxA.name].skeleton.y));
                    skeletons[hitboxB.name].skeleton.x = Math.max(margin + boundsB.size.x / 2, Math.min(WORLD_WIDTH - margin - boundsB.size.x / 2, skeletons[hitboxB.name].skeleton.x));
                    skeletons[hitboxB.name].skeleton.y = Math.max(margin + boundsB.size.y / 2, Math.min(WORLD_HEIGHT - margin - boundsB.size.y / 2, skeletons[hitboxB.name].skeleton.y));

                    console.log(`Separated ${hitboxA.name} to x=${skeletons[hitboxA.name].skeleton.x}, y=${skeletons[hitboxA.name].skeleton.y} and ${hitboxB.name} to x=${skeletons[hitboxB.name].skeleton.x}, y=${skeletons[hitboxB.name].skeleton.y}`);
                }
            }
        });
    });

    if (showHitbox) {
        hitboxCtx.strokeStyle = "rgba(255, 0, 0, 0.8)";
        hitboxCtx.lineWidth = 2;
        hitboxes.forEach(hitbox => {
            if (isNaN(hitbox.x) || isNaN(hitbox.y)) {
                console.warn(`Skipping draw hitbox for ${hitbox.name} due to invalid coordinates: x=${hitbox.x}, y=${hitbox.y}`);
                return;
            }
            const { screenX, screenY } = worldToScreen(hitbox.x, hitbox.y);
            hitboxCtx.beginPath();
            hitboxCtx.arc(screenX, screenY, hitbox.radius * camera.zoom, 0, 2 * Math.PI);
            hitboxCtx.stroke();
            console.log(`Drawing red hitbox for ${hitbox.name}: x=${screenX}, y=${screenY}, radius=${hitbox.radius * camera.zoom}`);
        });
    }

    if (showHealthBar) {
        hitboxes.forEach(hitbox => {
            if (isNaN(hitbox.x) || isNaN(hitbox.y)) {
                console.warn(`Skipping draw health bar for ${hitbox.name} due to invalid coordinates: x=${hitbox.x}, y=${hitbox.y}`);
                return;
            }
            if (health[hitbox.name] > 0) {
                const healthWidth = 50;
                const healthHeight = 5;
                const { screenX, screenY } = worldToScreen(hitbox.x, hitbox.y);
                const x = screenX - healthWidth / 2;
                const y = screenY - hitbox.radius - 10 - healthHeight - 150; // Đặt thanh máu phía trên hitbox
                const healthPercentage = Math.max(0, health[hitbox.name]) / 50;

                hitboxCtx.fillStyle = "rgba(100, 100, 100, 0.8)";
                hitboxCtx.fillRect(x, y, healthWidth, healthHeight);

                const red = Math.floor((1 - healthPercentage) * 255);
                const green = Math.floor(healthPercentage * 255);
                hitboxCtx.fillStyle = `rgba(${red}, ${green}, 0, 0.8)`;
                hitboxCtx.fillRect(x, y, healthWidth * healthPercentage, healthHeight);

                hitboxCtx.strokeStyle = "rgba(255, 255, 255, 0.8)";
                hitboxCtx.lineWidth = 1;
                hitboxCtx.strokeRect(x, y, healthWidth, healthHeight);
            }
        });
    }

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

    // Cố định camera.zoom
    camera.zoom = 1; // Giá trị cố định, điều chỉnh theo nhu cầu

    // Tính toán kích thước hiển thị dựa trên canvas và zoom cố định
    const width = canvas.width / camera.zoom;
    const height = canvas.height / camera.zoom;
    const centerX = camera.x;
    const centerY = camera.y;

    // Cập nhật ma trận chiếu để phù hợp với kích thước canvas
    mvp.ortho2d(centerX - width / 2, centerY - height / 2, width, height);
    gl.viewport(0, 0, canvas.width, canvas.height);
}

init();