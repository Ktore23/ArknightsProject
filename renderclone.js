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
var randomAnimationTimer = {};
var isPlayingRandomAnimation = {};
var attackSequence = {};
var isMouseHeld = false;

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
        const skeleton = loadSkeleton(name, "Idle", false, "default", skeletonData);
        if (skeleton) {
            const index = Object.keys(skeletons).length;
            skeletons[name] = skeleton;
            skeletons[name].skeleton.x = (canvas.width / 4) * (index + 0.5);
            skeletons[name].skeleton.y = canvas.height / 2;
            if (name !== $("#playerCharacter").val()) {
                velocities[name] = { vx: 0, vy: 0 };
                lastAnimation[name] = "Idle";
                health[name] = 50;
                isDying[name] = false;
                idleTime[name] = 0;
                isInRelaxState[name] = false;
                isInAttackState[name] = false;
                isPlayingRandomAnimation[name] = false;
                attackSequence[name] = { stage: null };
            }
            return true;
        }
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
        const character = skeletonData.find(c => c.name === selectedCharacter);
        const initialAnimation = character && character.type === "operator" ? "Relax" : "Move";
        const skeleton = loadSkeleton(selectedCharacter, initialAnimation, false, "default", skeletonData);
        if (skeleton) {
            skeletons[selectedCharacter] = skeleton;
            skeletons[selectedCharacter].skeleton.x = canvas.width / 2;
            skeletons[selectedCharacter].skeleton.y = canvas.height / 2;
            lastAnimation[selectedCharacter] = initialAnimation;
            health[selectedCharacter] = 50;
            isDying[selectedCharacter] = false;
            idleTime[selectedCharacter] = 0;
            isInRelaxState[selectedCharacter] = character && character.type === "operator";
            isInAttackState[selectedCharacter] = false;
            randomAnimationTimer[selectedCharacter] = 0;
            isPlayingRandomAnimation[selectedCharacter] = false;
            attackSequence[selectedCharacter] = { stage: null };
            console.log(`Successfully initialized character: ${selectedCharacter} with animation: ${initialAnimation}, isInRelaxState: ${isInRelaxState[selectedCharacter]}`);
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
            playerCharacterSelect.on("change", function() {
                skeletons = {};
                velocities = {};
                lastAnimation = {};
                health = {};
                isDying = {};
                idleTime = {};
                isInRelaxState = {};
                attackStartTime = {};
                isInAttackState = {};
                isLeftMouseClicked = false;
                isMouseHeld = false;
                hasTriggeredAttack = false;
                isAttacking = false;
                attackHitboxes = [];
                randomAnimationTimer = {};
                isPlayingRandomAnimation = {};
                attackSequence = {};
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
                console.log(`${name} - Entered Relax/Idle state, isInRelaxState: ${isInRelaxState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
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
                        if (isPlayingRandomAnimation[name]) {
                            const relaxAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "relax")?.name || "Idle";
                            target.state.setAnimation(0, relaxAnim, true);
                            lastAnimation[name] = relaxAnim;
                            isInRelaxState[name] = relaxAnim.toLowerCase() === "relax";
                            isPlayingRandomAnimation[name] = false;
                            randomAnimationTimer[name] = 0;
                            console.log(`${name} - Returned to ${relaxAnim} after completing random animation ${track.animation.name}, isInRelaxState: ${isInRelaxState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                        }
                    }
                }

                if (track.animation.name.toLowerCase() === "attack_pre") {
                    attackSequence[name].stage = "attack";
                    const attackAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack")?.name;
                    if (attackAnim) {
                        target.state.setAnimation(0, attackAnim, false);
                        console.log(`${name} - Transitioned from Attack_Pre to Attack`);
                    } else {
                        endAttackSequence(name, target, character);
                    }
                } else if (track.animation.name.toLowerCase() === "attack") {
                    const attackEndAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack_end")?.name;
                    if (attackEndAnim) {
                        attackSequence[name].stage = "attack_end";
                        target.state.setAnimation(0, attackEndAnim, false);
                        console.log(`${name} - Transitioned from Attack to Attack_End`);
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
                if (Object.keys(skeletons).length === 0) {
                    $("#playerCharacter").trigger("change");
                }
            }
        },
        event: function (track, event) {
            console.log("Event on track " + track.trackIndex + " at time " + event.time + ": " + event.data.name);
            if (event.data.name === "OnAttack") {
                console.log(`Processing OnAttack event for ${name} at time ${event.time}`);
                const hitboxes = Object.keys(skeletons).map(n => {
                    const skeleton = skeletons[n]?.skeleton;
                    return { name: n, x: skeleton.x, y: skeleton.y, radius: 50, skeleton };
                });

                console.log("Current attackHitboxes:", attackHitboxes);

                attackHitboxes.forEach(attackHitbox => {
                    hitboxes.forEach(hitbox => {
                        if (attackHitbox.name === hitbox.name) return;
                        const dx = hitbox.x - attackHitbox.skeleton.x;
                        const dy = hitbox.y - attackHitbox.skeleton.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const attackRangeExtension = 30;
                        const effectiveAttackRadius = attackHitbox.radius + attackRangeExtension;
                        console.log(`Checking collision: ${attackHitbox.name} vs ${hitbox.name}, dist: ${dist}, threshold: ${effectiveAttackRadius}`);
                        if (dist < effectiveAttackRadius) {
                            const angleToTarget = Math.atan2(-dy, dx) * (180 / Math.PI);
                            const angleToMouse = Math.atan2(-(canvas.height - mousePosition.y - attackHitbox.skeleton.y), mousePosition.x - attackHitbox.skeleton.x) * (180 / Math.PI);
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
                                            const { state, skeleton } = targetSkeleton;
                                            const dieAnimation = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "die")?.name;
                                            if (dieAnimation) {
                                                console.log(`Chuyển ${hitbox.name} sang animation Die`);
                                                state.setAnimation(0, dieAnimation, false);
                                            } else {
                                                console.warn(`No Die animation for ${hitbox.name}, removing immediately`);
                                                delete skeletons[hitbox.name];
                                                delete velocities[hitbox.name];
                                                delete health[hitbox.name];
                                                delete isDying[hitbox.name];
                                                delete attackStartTime[hitbox.name];
                                                delete isInAttackState[hitbox.name];
                                                delete isPlayingRandomAnimation[hitbox.name];
                                                delete attackSequence[hitbox.name];
                                                if (Object.keys(skeletons).length === 0) {
                                                    $("#playerCharacter").trigger("change");
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
                });
                hasTriggeredAttack = true;
            }
        }
    };
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

function loadSkeleton(name, initialAnimation, premultipliedAlpha, skin, data) {
    if (skin === undefined) skin = "default";

    const character = data.find(c => c.name === name);
    if (!character) {
        console.error(`Character ${name} not found in data`);
        return null;
    }

    const isOperator = character.type === "operator";
    const skelPathToUse = isOperator && character.altSkelPath ? character.altSkelPath : character.skelPath;
    const atlasPathToUse = isOperator && character.altAtlasPath ? character.altAtlasPath : character.atlasPath;

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
            console.error("Invalid skeleton data: No bones, slots, or skins");
            return null;
        }
        if (!skeletonDataLocal.animations || !skeletonDataLocal.animations.length) {
            console.error("No animations found in skeleton data");
            return null;
        }
    } catch (e) {
        console.error(`Failed to read skeleton data for ${skelPathToUse}: ${e.message}`);
        return null;
    }

    const skeleton = new spine.Skeleton(skeletonDataLocal);
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
            console.log(`Setting animation ${animationToUse} for ${name} with loop: ${initialAnimation.toLowerCase() !== "attack"}`);
            animationState.setAnimation(0, animationToUse, initialAnimation.toLowerCase() !== "attack");

            animationState.addListener(createAnimationListener(name));

            if (name === $("#playerCharacter").val()) {
                isAttacking = false;
                isInAttackState[name] = false;
                attackHitboxes = [];
                delete attackStartTime[name];
                lastAnimation[name] = animationToUse;
                isPlayingRandomAnimation[name] = false;
                isInRelaxState[name] = animationToUse.toLowerCase() === "relax" || animationToUse.toLowerCase() === "idle";
                attackSequence[name] = { stage: null };
                console.log(`After switching skeleton file for ${name}, set isInRelaxState: ${isInRelaxState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
            }

            skeletons[name] = { skeleton: newSkeleton, state: animationState, bounds: calculateSetupPoseBounds(newSkeleton), premultipliedAlpha: skeletons[name]?.premultipliedAlpha || false };
            console.log(`Successfully switched ${name} to new skeleton file: ${newSkelPath} with animation ${animationState.tracks[0]?.animation?.name}`);
            if (callback) callback(true);
        } else {
            console.warn(`Assets for ${newSkelPath} not yet loaded, retrying... (attempt ${retryCount + 1}/${maxRetries})`);
            retryCount++;
            requestAnimationFrame(attemptSwitch);
        }
    }

    attemptSwitch();
    return true;
}

function render() {
    if (Object.keys(skeletons).length === 0) {
        console.log("No skeletons to render, triggering character selection");
        $("#playerCharacter").trigger("change");
        return;
    }

    var now = Date.now() / 1000;
    var delta = now - lastFrameTime;
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

        const baseRadius = 50;
        const current = { name, x: skeleton.x, y: skeleton.y, radius: baseRadius, skeleton };
        hitboxes.push(current);

        if (name === $("#playerCharacter").val()) {
            let vx = 0, vy = 0, speed = 100;
            if (!isInAttackState[name] && !isDying[name]) {
                if (keys['ArrowLeft'] || keys['KeyA']) { vx = -speed; skeleton.scaleX = -1; }
                if (keys['ArrowRight'] || keys['KeyD']) { vx = speed; skeleton.scaleX = 1; }
                if (keys['ArrowUp'] || keys['KeyW']) vy = speed;
                if (keys['ArrowDown'] || keys['KeyS']) vy = -speed;

                skeleton.x += vx * delta;
                skeleton.y += vy * delta;

                const margin = 0;
                skeleton.x = Math.max(margin + bounds.size.x / 2, Math.min(canvas.width - margin - bounds.size.x / 2, skeleton.x));
                skeleton.y = Math.max(margin + bounds.size.y / 2, Math.min(canvas.height - margin - bounds.size.y / 2, skeleton.y));

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
                                randomAnimationTimer[name] = 0;
                                console.log(`${name} - Switched to animation: ${targetAnim}, isInRelaxState: ${isInRelaxState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                            }
                        }

                        if (vx === 0 && vy === 0) {
                            idleTime[name] += delta;
                            if (isInRelaxState[name]) {
                                randomAnimationTimer[name] += delta;
                                console.log(`${name} - Idle time: ${idleTime[name]}s, Random animation timer: ${randomAnimationTimer[name]}s, isInRelaxState: ${isInRelaxState[name]}, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                                if (randomAnimationTimer[name] >= 5 && isInRelaxState[name] && !isPlayingRandomAnimation[name]) {
                                    const availableAnimations = skeleton.data.animations
                                        .filter(anim => !["default", "relax", "move"].includes(anim.name.toLowerCase()))
                                        .map(anim => anim.name);
                                    console.log(`${name} - Available animations for random selection: ${availableAnimations.join(", ")}`);
                                    if (availableAnimations.length > 0) {
                                        const randomAnim = availableAnimations[Math.floor(Math.random() * availableAnimations.length)];
                                        state.setAnimation(0, randomAnim, false);
                                        lastAnimation[name] = randomAnim;
                                        isInRelaxState[name] = false;
                                        isPlayingRandomAnimation[name] = true;
                                        randomAnimationTimer[name] = 0;
                                        console.log(`${name} - Switched to random animation: ${randomAnim} after 5 seconds, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                                    } else {
                                        console.warn(`${name} - No valid animations available for random selection, staying in Relax`);
                                    }
                                } else if (randomAnimationTimer[name] >= 5 && !isInRelaxState[name] && !isPlayingRandomAnimation[name]) {
                                    console.warn(`${name} - Not in Relax state after 5 seconds, forcing Relax animation`);
                                    state.setAnimation(0, "Relax", true);
                                    lastAnimation[name] = "Relax";
                                    isInRelaxState[name] = true;
                                    isPlayingRandomAnimation[name] = false;
                                    randomAnimationTimer[name] = 0;
                                }
                            }
                        } else {
                            idleTime[name] = 0;
                            randomAnimationTimer[name] = 0;
                            isPlayingRandomAnimation[name] = false;
                            console.log(`${name} - Moving, resetting timers, isPlayingRandomAnimation: ${isPlayingRandomAnimation[name]}`);
                        }
                    } else {
                        const targetAnim = (vx !== 0 || vy !== 0) ? "Move" : idleAnim;
                        if (lastAnimation[name] !== targetAnim) {
                            state.setAnimation(0, targetAnim, true);
                            lastAnimation[name] = targetAnim;
                            console.log("Switched to animation: " + targetAnim);
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
                    switchSkeletonFile(name, character.skelPath, character.atlasPath, "Attack_Pre", (success) => {
                        const target = skeletons[name];
                        if (target) {
                            if (success) {
                                const attackPreAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack_pre")?.name;
                                const attackAnim = target.skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack")?.name;
                                if (attackPreAnim) {
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
                                    console.log(`Started Attack for ${name} (no Attack_Pre), available animations: ${target.skeleton.data.animations.map(a => a.name).join(", ")}`);
                                } else {
                                    console.error(`No Attack or Attack_Pre animation found for ${name}, available animations: ${target.skeleton.data.animations.map(a => a.name).join(", ")}`);
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
                    const attackPreAnim = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack_pre")?.name;
                    const attackAnim = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "attack")?.name;
                    if (attackPreAnim) {
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
                            console.log(`Triggered Attack animation for ${name} without switching file, previous animation: ${lastAnimation[name]}`);
                        } catch (e) {
                            console.error(`Failed to set Attack animation for ${name}: ${e.message}`);
                            isInAttackState[name] = false;
                        }
                    } else {
                        console.warn(`No Attack or Attack_Pre animation available for ${name} in current skeleton, available animations: ${skeleton.data.animations.map(a => a.name).join(", ")}`);
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
                const dx = mousePosition.x - skeleton.x;
                const dy = (canvas.height - mousePosition.y) - skeleton.y;
                skeleton.scaleX = dx >= 0 ? 1 : -1;

                const attackRadius = 100;
                const attackRangeExtension = 30;
                const attackHitboxX = skeleton.x;
                const attackHitboxY = skeleton.y;

                const attackHitbox = { name, x: attackHitboxX, y: attackHitboxY, radius: attackRadius, skeleton };
                attackHitboxes.push(attackHitbox);

                if (showHitbox) {
                    hitboxCtx.strokeStyle = "rgba(255, 165, 0, 0.8)";
                    hitboxCtx.fillStyle = "rgba(255, 165, 0, 0.3)";
                    hitboxCtx.beginPath();
                    const angleToMouse = Math.atan2(-(canvas.height - mousePosition.y - skeleton.y), mousePosition.x - skeleton.x);
                    const startAngle = angleToMouse - Math.PI / 4;
                    const endAngle = angleToMouse + Math.PI / 4;
                    const effectiveAttackRadius = attackRadius + attackRangeExtension;
                    hitboxCtx.arc(skeleton.x, canvas.height - skeleton.y, effectiveAttackRadius, startAngle, endAngle);
                    hitboxCtx.fill();
                    hitboxCtx.stroke();
                    console.log(`Drawing attack hitbox for ${name}: x=${skeleton.x}, y=${canvas.height - skeleton.y}, radius=${effectiveAttackRadius}`);
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
                    if (velocities[name].vx === 0 && velocities[name].vy === 0) {
                        velocities[name].vx = (Math.random() - 0.5) * 200;
                        velocities[name].vy = (Math.random() - 0.5) * 200;
                        console.log(`Initialized velocity for ${name}: vx=${velocities[name].vx}, vy=${velocities[name].vy}`);
                    }

                    skeleton.x += velocities[name].vx * delta;
                    skeleton.y += velocities[name].vy * delta;

                    if (velocities[name].vx > 0) skeleton.scaleX = 1;
                    else if (velocities[name].vx < 0) skeleton.scaleX = -1;

                    const margin = 0;
                    if (skeleton.x < margin + bounds.size.x / 2 || skeleton.x > canvas.width - margin - bounds.size.x / 2)
                        velocities[name].vx *= -1;
                    if (skeleton.y < margin + bounds.size.y / 2 || skeleton.y > canvas.height - margin - bounds.size.y / 2)
                        velocities[name].vy *= -1;

                    if (currentAnimation !== "Move") {
                        state.setAnimation(0, "Move", true);
                        lastAnimation[name] = "Move";
                        console.log(`Switched ${name} to Move animation due to auto movement`);
                    }
                } else {
                    velocities[name].vx = 0;
                    velocities[name].vy = 0;
                    if (currentAnimation !== "Idle") {
                        const idleAnim = skeleton.data.animations.find(anim => anim.name.toLowerCase() === "idle")?.name || skeleton.data.animations[0]?.name || "Idle";
                        state.setAnimation(0, idleAnim, true);
                        lastAnimation[name] = idleAnim;
                        console.log(`Switched ${name} to Idle animation due to auto movement being off`);
                    }
                }

                if (velocities[name].vx === 0 && velocities[name].vy === 0) {
                    idleTime[name] += delta;
                    console.log(`Idle time for ${name} (other): ${idleTime[name]}s`);
                    if (idleTime[name] >= 5) {
                        let character;
                        if (Array.isArray(skeletonData)) {
                            character = skeletonData.find(c => c.name === name);
                        } else {
                            console.warn(`skeletonData is not an array for ${name}, skipping character lookup`);
                            character = null;
                        }
                        if (character && character.type === "operator" && character.altSkelPath && character.altAtlasPath) {
                            switchSkeletonFile(name, character.altSkelPath, character.altAtlasPath, "Relax", () => {
                                console.log(`Switched ${name} to Relax`);
                            });
                            isInRelaxState[name] = true;
                            idleTime[name] = 0;
                            console.log(`Switched to Relax for ${name} using altSkelPath`);
                        }
                    }
                } else {
                    idleTime[name] = 0;
                }
            }
        }

        current.x = skeleton.x;
        current.y = skeleton.y;

        state.update(delta);
        state.apply(skeleton);
        skeleton.updateWorldTransform();

        skeletonRenderer.vertexEffect = null;
        skeletonRenderer.premultipliedAlpha = premultipliedAlpha;
        skeletonRenderer.draw(batcher, skeleton);
    });

    if (showHitbox) {
        hitboxes.forEach((hitboxA, indexA) => {
            hitboxes.forEach((hitboxB, indexB) => {
                if (indexA === indexB) return;
                const dx = hitboxB.x - hitboxA.x;
                const dy = hitboxB.y - hitboxA.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = hitboxA.radius + hitboxB.radius;

                if (dist < minDist) {
                    const overlap = minDist - dist;
                    const adjustX = (overlap * dx / dist) / 2;
                    const adjustY = (overlap * dy / dist) / 2;

                    skeletons[hitboxA.name].skeleton.x -= adjustX;
                    skeletons[hitboxA.name].skeleton.y -= adjustY;
                    skeletons[hitboxB.name].skeleton.x += adjustX;
                    skeletons[hitboxB.name].skeleton.y += adjustY;

                    console.log(`Collision detected between ${hitboxA.name} and ${hitboxB.name}, adjusted positions`);
                }
            });
        });

        hitboxCtx.strokeStyle = "rgba(255, 0, 0, 0.8)";
        hitboxCtx.lineWidth = 2;
        hitboxes.forEach(hitbox => {
            hitboxCtx.beginPath();
            hitboxCtx.arc(hitbox.x, canvas.height - hitbox.y, hitbox.radius, 0, 2 * Math.PI);
            hitboxCtx.stroke();
            console.log(`Drawing red hitbox for ${hitbox.name}: x=${hitbox.x}, y=${canvas.height - hitbox.y}, radius=${hitbox.radius}`);
        });
    }

    if (showHealthBar) {
        hitboxes.forEach(hitbox => {
            if (health[hitbox.name] > 0) {
                const healthWidth = 50;
                const healthHeight = 5;
                const x = hitbox.x - healthWidth / 2;
                const y = canvas.height - (hitbox.y + hitbox.radius + 150);
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