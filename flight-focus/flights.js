/*
 * Flight Focus 靜態航班資料庫
 * 以 script 引入而非 fetch，確保 file:// 雙擊開啟時不受 CORS 限制。
 * 座標順序為 [緯度, 經度]；飛行分鐘數為專注模擬使用的預估時間。
 */
(function () {
  'use strict';

  const airports = {
    HKG: { city: '香港', name: '香港國際機場', lat: 22.3080, lng: 113.9185, tz: 'Asia/Hong_Kong' },
    MFM: { city: '澳門', name: '澳門國際機場', lat: 22.1496, lng: 113.5915, tz: 'Asia/Macau' },
    CAN: { city: '廣州', name: '廣州白雲國際機場', lat: 23.3924, lng: 113.2988, tz: 'Asia/Shanghai' },
    SZX: { city: '深圳', name: '深圳寶安國際機場', lat: 22.6393, lng: 113.8107, tz: 'Asia/Shanghai' },
    ZUH: { city: '珠海', name: '珠海金灣機場', lat: 22.0064, lng: 113.3760, tz: 'Asia/Shanghai' },
    SHA: { city: '上海', name: '上海虹橋國際機場', lat: 31.1979, lng: 121.3363, tz: 'Asia/Shanghai' },
    PVG: { city: '上海', name: '上海浦東國際機場', lat: 31.1443, lng: 121.8083, tz: 'Asia/Shanghai' },
    HGH: { city: '杭州', name: '杭州蕭山國際機場', lat: 30.2295, lng: 120.4344, tz: 'Asia/Shanghai' },
    CTU: { city: '成都', name: '成都雙流國際機場', lat: 30.5785, lng: 103.9471, tz: 'Asia/Shanghai' },
    XIY: { city: '西安', name: '西安咸陽國際機場', lat: 34.4471, lng: 108.7516, tz: 'Asia/Shanghai' },
    HRB: { city: '哈爾濱', name: '哈爾濱太平國際機場', lat: 45.6234, lng: 126.2503, tz: 'Asia/Shanghai' },
    HAK: { city: '海口', name: '海口美蘭國際機場', lat: 19.9349, lng: 110.4589, tz: 'Asia/Shanghai' },
    XMN: { city: '廈門', name: '廈門高崎國際機場', lat: 24.5440, lng: 118.1277, tz: 'Asia/Shanghai' },
    TPE: { city: '台北', name: '桃園國際機場', lat: 25.0797, lng: 121.2342, tz: 'Asia/Taipei' },
    MNL: { city: '馬尼拉', name: '尼諾伊·艾奎諾國際機場', lat: 14.5086, lng: 121.0194, tz: 'Asia/Manila' },
    BKK: { city: '曼谷', name: '蘇凡納布機場', lat: 13.6900, lng: 100.7501, tz: 'Asia/Bangkok' },
    KUL: { city: '吉隆坡', name: '吉隆坡國際機場', lat: 2.7456, lng: 101.7099, tz: 'Asia/Kuala_Lumpur' },
    ICN: { city: '首爾', name: '仁川國際機場', lat: 37.4602, lng: 126.4407, tz: 'Asia/Seoul' },
    SGN: { city: '胡志明市', name: '新山一國際機場', lat: 10.8188, lng: 106.6520, tz: 'Asia/Ho_Chi_Minh' },
    SIN: { city: '新加坡', name: '樟宜機場', lat: 1.3644, lng: 103.9915, tz: 'Asia/Singapore' },
    NRT: { city: '東京', name: '成田國際機場', lat: 35.7720, lng: 140.3929, tz: 'Asia/Tokyo' },
    HND: { city: '東京', name: '羽田機場', lat: 35.5494, lng: 139.7798, tz: 'Asia/Tokyo' },
    KIX: { city: '大阪', name: '關西國際機場', lat: 34.4347, lng: 135.2440, tz: 'Asia/Tokyo' },
    ISG: { city: '石垣島', name: '新石垣機場', lat: 24.3964, lng: 124.2450, tz: 'Asia/Tokyo' },
    OKA: { city: '沖繩', name: '那霸機場', lat: 26.1958, lng: 127.6458, tz: 'Asia/Tokyo' },
    KOJ: { city: '鹿兒島', name: '鹿兒島機場', lat: 31.8034, lng: 130.7194, tz: 'Asia/Tokyo' },
    FUK: { city: '福岡', name: '福岡機場', lat: 33.5859, lng: 130.4507, tz: 'Asia/Tokyo' },
    HIJ: { city: '廣島', name: '廣島機場', lat: 34.4361, lng: 132.9194, tz: 'Asia/Tokyo' },
    TAK: { city: '高松', name: '高松機場', lat: 34.2142, lng: 134.0156, tz: 'Asia/Tokyo' },
    NGO: { city: '名古屋', name: '中部國際機場', lat: 34.8584, lng: 136.8054, tz: 'Asia/Tokyo' },
    SDJ: { city: '仙台', name: '仙台機場', lat: 38.1397, lng: 140.9169, tz: 'Asia/Tokyo' },
    CTS: { city: '札幌', name: '新千歲機場', lat: 42.7752, lng: 141.6923, tz: 'Asia/Tokyo' },
    PEK: { city: '北京', name: '首都國際機場', lat: 40.0799, lng: 116.6031, tz: 'Asia/Shanghai' },
    DXB: { city: '杜拜', name: '杜拜國際機場', lat: 25.2532, lng: 55.3657, tz: 'Asia/Dubai' },
    PER: { city: '珀斯', name: '珀斯機場', lat: -31.9403, lng: 115.9670, tz: 'Australia/Perth' },
    MEL: { city: '墨爾本', name: '墨爾本機場', lat: -37.6690, lng: 144.8410, tz: 'Australia/Melbourne' },
    SYD: { city: '悉尼', name: '悉尼機場', lat: -33.9399, lng: 151.1753, tz: 'Australia/Sydney' },
    BNE: { city: '布里斯本', name: '布里斯本機場', lat: -27.3842, lng: 153.1175, tz: 'Australia/Brisbane' },
    DOH: { city: '多哈', name: '哈馬德國際機場', lat: 25.2731, lng: 51.6081, tz: 'Asia/Qatar' },
    AKL: { city: '奧克蘭', name: '奧克蘭機場', lat: -37.0082, lng: 174.7850, tz: 'Pacific/Auckland' },
    HEL: { city: '赫爾辛基', name: '萬塔機場', lat: 60.3172, lng: 24.9633, tz: 'Europe/Helsinki' },
    LHR: { city: '倫敦', name: '希斯路機場', lat: 51.4700, lng: -0.4543, tz: 'Europe/London' },
    EDI: { city: '愛丁堡', name: '愛丁堡機場', lat: 55.9508, lng: -3.3615, tz: 'Europe/London' },
    MAN: { city: '曼徹斯特', name: '曼徹斯特機場', lat: 53.3537, lng: -2.2750, tz: 'Europe/London' },
    CDG: { city: '巴黎', name: '戴高樂機場', lat: 49.0097, lng: 2.5479, tz: 'Europe/Paris' },
    FRA: { city: '法蘭克福', name: '法蘭克福機場', lat: 50.0379, lng: 8.5622, tz: 'Europe/Berlin' },
    MUC: { city: '慕尼黑', name: '慕尼黑機場', lat: 48.3538, lng: 11.7861, tz: 'Europe/Berlin' },
    BER: { city: '柏林', name: '柏林勃蘭登堡機場', lat: 52.3667, lng: 13.5033, tz: 'Europe/Berlin' },
    IST: { city: '伊斯坦堡', name: '伊斯坦堡機場', lat: 41.2753, lng: 28.7519, tz: 'Europe/Istanbul' },
    AMS: { city: '阿姆斯特丹', name: '阿姆斯特丹史基浦機場', lat: 52.3105, lng: 4.7683, tz: 'Europe/Amsterdam' },
    BCN: { city: '巴塞隆拿', name: '巴塞隆拿埃爾普拉特機場', lat: 41.2974, lng: 2.0833, tz: 'Europe/Madrid' },
    ATH: { city: '雅典', name: '雅典埃萊夫塞里奧斯·韋尼澤洛斯國際機場', lat: 37.9364, lng: 23.9445, tz: 'Europe/Athens' },
    BOM: { city: '孟買', name: '孟買賈特拉帕蒂·希瓦吉·馬哈拉傑國際機場', lat: 19.0896, lng: 72.8656, tz: 'Asia/Kolkata' }
  };

  const routes = [
    { id: 'CX494', from: 'HKG', to: 'TPE', number: 'CX 494', airline: '國泰航空', aircraft: 'A330-300', minutes: 95 },
    { id: 'NX610', from: 'MFM', to: 'TPE', number: 'NX 610', airline: '澳門航空', aircraft: 'A321neo', minutes: 105 },
    { id: 'CX901', from: 'HKG', to: 'MNL', number: 'CX 901', airline: '國泰航空', aircraft: 'A330-300', minutes: 130 },
    { id: 'NX936', from: 'MFM', to: 'BKK', number: 'NX 936', airline: '澳門航空', aircraft: 'A320neo', minutes: 175 },
    { id: 'CX751', from: 'HKG', to: 'BKK', number: 'CX 751', airline: '國泰航空', aircraft: 'A330-300', minutes: 180 },
    { id: 'CA112', from: 'HKG', to: 'PEK', number: 'CA 112', airline: '中國國際航空', aircraft: 'A330-300', minutes: 205 },
    { id: 'CX410', from: 'HKG', to: 'ICN', number: 'CX 410', airline: '國泰航空', aircraft: 'A330-300', minutes: 210 },
    { id: 'CX767', from: 'HKG', to: 'SGN', number: 'CX 767', airline: '國泰航空', aircraft: 'A330-300', minutes: 165 },
    { id: 'UO686', from: 'HKG', to: 'KIX', number: 'UO 686', airline: '香港快運', aircraft: 'A321neo', minutes: 225 },
    { id: 'SQ891', from: 'HKG', to: 'SIN', number: 'SQ 891', airline: '新加坡航空', aircraft: 'A350-900', minutes: 240 },
    { id: 'CX548', from: 'HKG', to: 'HND', number: 'CX 548', airline: '國泰航空', aircraft: 'B777-300', minutes: 255 },
    { id: 'CX504', from: 'HKG', to: 'NRT', number: 'CX 504', airline: '國泰航空', aircraft: 'B777-300', minutes: 270 },
    { id: 'EK381', from: 'HKG', to: 'DXB', number: 'EK 381', airline: '阿聯酋航空', aircraft: 'A380-800', minutes: 480 },
    { id: 'CX171', from: 'HKG', to: 'PER', number: 'CX 171', airline: '國泰航空', aircraft: 'A330-300', minutes: 480 },
    { id: 'CX157', from: 'HKG', to: 'BNE', number: 'CX 157', airline: '國泰航空', aircraft: 'A350-900', minutes: 520 },
    { id: 'QR817', from: 'HKG', to: 'DOH', number: 'QR 817', airline: '卡塔爾航空', aircraft: 'B777-300ER', minutes: 525 },
    { id: 'CX105', from: 'HKG', to: 'MEL', number: 'CX 105', airline: '國泰航空', aircraft: 'A350-1000', minutes: 545 },
    { id: 'CX101', from: 'HKG', to: 'SYD', number: 'CX 101', airline: '國泰航空', aircraft: 'A350-1000', minutes: 550 },
    { id: 'CX113', from: 'HKG', to: 'AKL', number: 'CX 113', airline: '國泰航空', aircraft: 'A350-1000', minutes: 640 },
    { id: 'AY100', from: 'HKG', to: 'HEL', number: 'AY 100', airline: '芬蘭航空', aircraft: 'A350-900', minutes: 800 },
    { id: 'LH797', from: 'HKG', to: 'FRA', number: 'LH 797', airline: '漢莎航空', aircraft: 'A340-300', minutes: 810 },
    { id: 'AF185', from: 'HKG', to: 'CDG', number: 'AF 185', airline: '法國航空', aircraft: 'B777-300ER', minutes: 835 },
    { id: 'CX251', from: 'HKG', to: 'LHR', number: 'CX 251', airline: '國泰航空', aircraft: 'B777-300ER', minutes: 840 },

    // 香港出發 · 日本航線
    { id: 'UO812', from: 'HKG', to: 'ISG', number: 'UO 812', airline: '香港快運', aircraft: 'A320neo', minutes: 130 },
    { id: 'HX658', from: 'HKG', to: 'OKA', number: 'HX 658', airline: '香港航空', aircraft: 'A320', minutes: 155 },
    { id: 'HX670', from: 'HKG', to: 'KOJ', number: 'HX 670', airline: '香港航空', aircraft: 'A320', minutes: 185 },
    { id: 'CX588', from: 'HKG', to: 'FUK', number: 'CX 588', airline: '國泰航空', aircraft: 'A330-300', minutes: 195 },
    { id: 'UO822', from: 'HKG', to: 'HIJ', number: 'UO 822', airline: '香港快運', aircraft: 'A320neo', minutes: 205 },
    { id: 'UO522', from: 'HKG', to: 'TAK', number: 'UO 522', airline: '香港快運', aircraft: 'A320neo', minutes: 210 },
    { id: 'CX536', from: 'HKG', to: 'NGO', number: 'CX 536', airline: '國泰航空', aircraft: 'A330-300', minutes: 220 },
    { id: 'UO890', from: 'HKG', to: 'SDJ', number: 'UO 890', airline: '香港快運', aircraft: 'A321neo', minutes: 265 },
    { id: 'CX580', from: 'HKG', to: 'CTS', number: 'CX 580', airline: '國泰航空', aircraft: 'B777-300', minutes: 285 },

    // 廣州出發
    { id: 'CZ3537', from: 'CAN', to: 'SHA', number: 'CZ 3537', airline: '中國南方航空', aircraft: 'B737-800', minutes: 135 },
    { id: 'CZ3523', from: 'CAN', to: 'HGH', number: 'CZ 3523', airline: '中國南方航空', aircraft: 'B737-800', minutes: 125 },
    { id: 'CZ3101', from: 'CAN', to: 'PEK', number: 'CZ 3101', airline: '中國南方航空', aircraft: 'B787-9', minutes: 195 },
    { id: 'CZ349', from: 'CAN', to: 'KUL', number: 'CZ 349', airline: '中國南方航空', aircraft: 'A321neo', minutes: 240 },
    { id: 'CZ363', from: 'CAN', to: 'BKK', number: 'CZ 363', airline: '中國南方航空', aircraft: 'A320neo', minutes: 180 },
    { id: 'CZ8101', from: 'CAN', to: 'NRT', number: 'CZ 8101', airline: '中國南方航空', aircraft: 'A330-300', minutes: 265 },
    { id: 'CZ353', from: 'CAN', to: 'SIN', number: 'CZ 353', airline: '中國南方航空', aircraft: 'A321neo', minutes: 245 },
    { id: 'CZ383', from: 'CAN', to: 'DXB', number: 'CZ 383', airline: '中國南方航空', aircraft: 'B787-9', minutes: 495 },
    { id: 'CZ325', from: 'CAN', to: 'SYD', number: 'CZ 325', airline: '中國南方航空', aircraft: 'A350-900', minutes: 560 },
    { id: 'CZ321', from: 'CAN', to: 'MEL', number: 'CZ 321', airline: '中國南方航空', aircraft: 'A350-900', minutes: 565 },
    { id: 'TK73', from: 'CAN', to: 'IST', number: 'TK 73', airline: '土耳其航空', aircraft: 'B787-9', minutes: 680 },
    { id: 'CZ307', from: 'CAN', to: 'AMS', number: 'CZ 307', airline: '中國南方航空', aircraft: 'A350-900', minutes: 750 },
    { id: 'CZ303', from: 'CAN', to: 'LHR', number: 'CZ 303', airline: '中國南方航空', aircraft: 'B787-9', minutes: 795 },

    // 深圳出發
    { id: 'ZH9501', from: 'SZX', to: 'SHA', number: 'ZH 9501', airline: '深圳航空', aircraft: 'A320neo', minutes: 135 },
    { id: 'ZH9401', from: 'SZX', to: 'CTU', number: 'ZH 9401', airline: '深圳航空', aircraft: 'A320neo', minutes: 155 },
    { id: 'ZH9101', from: 'SZX', to: 'PEK', number: 'ZH 9101', airline: '深圳航空', aircraft: 'B737-800', minutes: 195 },
    { id: 'ZH621', from: 'SZX', to: 'ICN', number: 'ZH 621', airline: '深圳航空', aircraft: 'A320neo', minutes: 210 },
    { id: 'ZH663', from: 'SZX', to: 'KIX', number: 'ZH 663', airline: '深圳航空', aircraft: 'A320neo', minutes: 230 },
    { id: 'ZH9023', from: 'SZX', to: 'SIN', number: 'ZH 9023', airline: '深圳航空', aircraft: 'A320neo', minutes: 240 },
    { id: 'CZ3071', from: 'SZX', to: 'SYD', number: 'CZ 3071', airline: '中國南方航空', aircraft: 'A330-300', minutes: 555 },
    { id: 'CA771', from: 'SZX', to: 'FRA', number: 'CA 771', airline: '中國國際航空', aircraft: 'A330-300', minutes: 760 },
    { id: 'ZH887', from: 'SZX', to: 'LHR', number: 'ZH 887', airline: '深圳航空', aircraft: 'A330-300', minutes: 810 },
    { id: 'ZH9065', from: 'SZX', to: 'BCN', number: 'ZH 9065', airline: '深圳航空', aircraft: 'A330-300', minutes: 820 },

    // 珠海出發
    { id: 'CZ3761', from: 'ZUH', to: 'PVG', number: 'CZ 3761', airline: '中國南方航空', aircraft: 'B737-800', minutes: 140 },
    { id: 'GJ8782', from: 'ZUH', to: 'HGH', number: 'GJ 8782', airline: '浙江長龍航空', aircraft: 'A320neo', minutes: 125 },
    { id: 'CA1474', from: 'ZUH', to: 'PEK', number: 'CA 1474', airline: '中國國際航空', aircraft: 'B737-800', minutes: 195 },
    { id: '3U8760', from: 'ZUH', to: 'CTU', number: '3U 8760', airline: '四川航空', aircraft: 'A320neo', minutes: 155 },
    { id: 'MU2348', from: 'ZUH', to: 'XIY', number: 'MU 2348', airline: '中國東方航空', aircraft: 'A320neo', minutes: 170 },
    { id: 'CZ3793', from: 'ZUH', to: 'HRB', number: 'CZ 3793', airline: '中國南方航空', aircraft: 'B737-800', minutes: 265 },

    // 其他經典國際航線
    { id: 'JL809', from: 'NRT', to: 'TPE', number: 'JL 809', airline: '日本航空', aircraft: 'B787-8', minutes: 210 },
    { id: 'BA632', from: 'LHR', to: 'ATH', number: 'BA 632', airline: '英國航空', aircraft: 'A320neo', minutes: 210 },
    { id: 'BA676', from: 'LHR', to: 'IST', number: 'BA 676', airline: '英國航空', aircraft: 'A321neo', minutes: 240 },
    { id: 'SQ231', from: 'SIN', to: 'SYD', number: 'SQ 231', airline: '新加坡航空', aircraft: 'A380-800', minutes: 475 },
    { id: 'JL51', from: 'NRT', to: 'SYD', number: 'JL 51', airline: '日本航空', aircraft: 'B787-9', minutes: 565 },
    { id: 'BA199', from: 'LHR', to: 'BOM', number: 'BA 199', airline: '英國航空', aircraft: 'B787-8', minutes: 540 },
    { id: 'TK55', from: 'SIN', to: 'IST', number: 'TK 55', airline: '土耳其航空', aircraft: 'B777-300ER', minutes: 660 },
    { id: 'SQ308', from: 'SIN', to: 'LHR', number: 'SQ 308', airline: '新加坡航空', aircraft: 'A350-900', minutes: 845 },
    { id: 'AY074', from: 'NRT', to: 'HEL', number: 'AY 074', airline: '芬蘭航空', aircraft: 'A350-900', minutes: 780 },

    // 大灣區及區域短途
    { id: 'CZ8632', from: 'ZUH', to: 'HAK', number: 'CZ 8632', airline: '中國南方航空', aircraft: 'B737-800', minutes: 75 },
    { id: 'CX978', from: 'HKG', to: 'XMN', number: 'CX 978', airline: '國泰航空', aircraft: 'A330-300', minutes: 95 },

    // 歐洲內陸短途
    { id: 'BA1438', from: 'LHR', to: 'EDI', number: 'BA 1438', airline: '英國航空', aircraft: 'A320neo', minutes: 85 },
    { id: 'BA1370', from: 'LHR', to: 'MAN', number: 'BA 1370', airline: '英國航空', aircraft: 'A320', minutes: 70 },
    { id: 'LH110', from: 'FRA', to: 'MUC', number: 'LH 110', airline: '漢莎航空', aircraft: 'A320neo', minutes: 55 },
    { id: 'LH180', from: 'FRA', to: 'BER', number: 'LH 180', airline: '漢莎航空', aircraft: 'A320neo', minutes: 70 }
  ];

  window.FLIGHT_FOCUS_DATA = Object.freeze({ airports, routes });
})();
