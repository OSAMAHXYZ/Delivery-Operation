/** Map product/model names to local car images (images/cars/) */
const TOYOTA_CAR_IMAGE_ENTRIES = [
    ['camry', 'كامري', 'images/cars/camry.png'],
    ['corolla cross', 'كورولا كروس', 'images/cars/corolla cross.png'],
    ['corolla', 'كورولا', 'images/cars/corolla.png'],
    ['land cruiser', 'لاند كروزر', 'lc300', 'images/cars/land cruiser.png'],
    ['urban cruiser', 'أوربان كروزر', 'urbancruiser', 'images/cars/urban cruiser.png'],
    ['highlander', 'هايلاندر', 'images/cars/highlander.png'],
    ['fortuner', 'فورتشنر', 'images/cars/fortuner.png'],
    ['innova', 'إنوفا', 'images/cars/innova.png'],
    ['prado', 'برادو', 'images/cars/prado.png'],
    ['rav4', 'راف فور', 'images/cars/rav4.png'],
    ['raize', 'رايز', 'images/cars/raize.png'],
    ['crown', 'كراون', 'images/cars/crown.png'],
    ['yaris', 'يارس', 'images/cars/yaris.png'],
    ['veloz', 'فيلوز', 'images/cars/veloz.png'],
    ['gr86', 'images/cars/gr86.png'],
    ['hilux', 'هايلكس', 'images/cars/hilux.png']
];

function resolveToyotaCarImage(productOrModel) {
    const text = String(productOrModel || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    for (const entry of TOYOTA_CAR_IMAGE_ENTRIES) {
        const image = entry[entry.length - 1];
        const keys = entry.slice(0, -1);
        if (keys.some((k) => text.includes(String(k).toLowerCase()))) return image;
    }
    return null;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TOYOTA_CAR_IMAGE_ENTRIES, resolveToyotaCarImage };
}
