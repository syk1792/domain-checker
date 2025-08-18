const whois = require('whois');
const util = require('util');

const lookup = util.promisify(whois.lookup);

/**
 * WHOIS가 반환하는 원본 텍스트 데이터에서 필요한 정보(만료일, 등록일, 등록기관)를 추출하는 함수입니다.
 * .kr 도메인의 다양한 형식을 처리하도록 파싱 로직을 개선했습니다.
 * @param {string} rawData - WHOIS 조회로 얻은 원본 텍스트 데이터
 * @returns {{expiry_date: string|null, creation_date: string|null, registrar: string|null}} - 추출된 정보 객체
 */
function parseWhoisData(rawData) {
    const lines = rawData.split('\n');
    let expiryDate = null;
    let creationDate = null;
    let registrar = null;

    // [FIX] 키워드에서 불필요한 공백과 콜론을 모두 제거하여 비교 정확도 향상
    const expiryKeywords = ['registry expiry date', 'registrar registration expiration date', 'expiry date', 'expires', 'expiration time', '만료일'];
    const creationKeywords = ['creation date', 'registration date', 'registered on', 'created', '등록일'];
    const registrarKeywords = ['registrar', 'registrar name', 'sponsoring registrar', '등록대행자'];

    for (const line of lines) {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) continue;

        // 키를 추출하고 소문자로 변환 후, 양 끝 공백을 제거합니다.
        const key = line.substring(0, separatorIndex).trim().toLowerCase();
        const value = line.substring(separatorIndex + 1).trim();

        // 키워드 목록에 현재 키가 포함되어 있는지 확인합니다.
        if (!expiryDate && expiryKeywords.includes(key)) {
            expiryDate = value;
        }
        if (!creationDate && creationKeywords.includes(key)) {
            creationDate = value;
        }
        if (!registrar && registrarKeywords.includes(key)) {
            registrar = value;
        }
    }

    return {
        expiry_date: expiryDate,
        creation_date: creationDate,
        registrar: registrar,
    };
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const domain = event.queryStringParameters?.domain;

    if (!domain) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: '도메인 파라미터가 필요합니다.' })
        };
    }

    try {
        const rawData = await lookup(domain, { follow: 2, verbose: true });
        
        // whois 라이브러리는 조회 결과를 배열로 반환할 수 있으므로, 문자열로 합칩니다.
        const rawText = Array.isArray(rawData) ? rawData.map(d => d.data).join('\n') : rawData;

        if (!rawText) {
            throw new Error('도메인 정보를 찾을 수 없습니다. (존재하지 않는 도메인일 수 있습니다)');
        }

        const parsedData = parseWhoisData(rawText);

        if (!parsedData.expiry_date) {
             throw new Error('도메인 만료일 정보를 파싱할 수 없습니다. 지원되지 않는 도메인 형식이거나 정보 조회가 제한된 도메인일 수 있습니다.');
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                domain: domain,
                ...parsedData,
                status: 'registered'
            })
        };

    } catch (error) {
        console.error('WHOIS Lookup Error:', error);
        
        let errorMessage = '도메인 정보를 조회하는 중 오류가 발생했습니다.';
        if (error.message && (error.message.includes('No match for domain') || error.message.includes('Domain not found'))) {
            errorMessage = '해당 도메인을 찾을 수 없습니다. 오타가 없는지 확인해주세요.';
        } else if (error.message) {
            errorMessage = error.message;
        }

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: errorMessage })
        };
    }
};
