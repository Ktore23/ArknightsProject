import { getDocs, collection } from 'https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js';
import { getSkeletonNames, addCharacter, showHitbox, setShowHitbox, refreshCanvas } from './render.js';

let availableCharacters = [];

async function loadCharactersFromFirebase(db) {
    console.log("Loading characters from Firebase in ui.js...");
    const charactersCollection = collection(db, "characters");
    const charactersSnapshot = await getDocs(charactersCollection);
    const charactersList = charactersSnapshot.docs.map(doc => doc.data());
    console.log("Characters loaded in ui.js:", charactersList);
    availableCharacters = charactersList;
    console.log("Updated availableCharacters:", availableCharacters);

    // Cập nhật skeletonNames trong render.js
    const skeletonNames = availableCharacters.map(character => character.name);
    const renderModule = await import('./render.js');
    renderModule.updateSkeletonData(skeletonNames, availableCharacters);

    return charactersList;
}

function setupUI() {
    console.log("Setting up UI...");
    const skeletonNames = getSkeletonNames();
    console.log("Available skeleton names for UI:", skeletonNames);

    // Cập nhật dropdown playerCharacter
    const playerCharacterSelect = $("#playerCharacter");
    playerCharacterSelect.empty();
    skeletonNames.forEach(name => {
        const character = availableCharacters.find(c => c.name === name);
        playerCharacterSelect.append(`<option value="${name}">${name} (${character.type})</option>`);
    });

    // Cập nhật dropdown addCharacter
    const addCharacterSelect = $("#addCharacter");
    addCharacterSelect.empty();
    addCharacterSelect.append('<option value="">Select a character to add</option>');
    skeletonNames.forEach(name => {
        const character = availableCharacters.find(c => c.name === name);
        addCharacterSelect.append(`<option value="${name}">${name} (${character.type})</option>`);
    });

    // Xử lý sự kiện khi chọn nhân vật để thêm
    addCharacterSelect.off('change').on('change', function() {
        const selectedCharacter = $(this).val();
        if (selectedCharacter) {
            const success = addCharacter(selectedCharacter);
            if (success) {
                console.log(`Added character ${selectedCharacter} to the scene`);
                // Reset dropdown sau khi thêm
                $(this).val('');
            } else {
                console.warn(`Failed to add character ${selectedCharacter}`);
            }
        }
    });

    // Cập nhật autoMoveToggle
    $("#autoMoveToggle").off('change').on('change', function() {
        console.log("Auto move toggle changed to:", $(this).is(":checked"));
    });

    // Xử lý hitboxToggle
    const hitboxToggle = $("#hitboxToggle");
    hitboxToggle.prop('checked', showHitbox); // Đồng bộ trạng thái ban đầu
    hitboxToggle.off('change').on('change', function() {
        setShowHitbox($(this).is(":checked")); // Sử dụng setter để cập nhật showHitbox
        console.log("Show hitbox toggle changed to:", showHitbox);
        refreshCanvas(); // Làm mới canvas để áp dụng thay đổi
    });
}

export { loadCharactersFromFirebase, setupUI };