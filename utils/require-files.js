const fs = require('fs');
const path = require('path');

const requireFiles = (directory, asObject = false) => {
	const requireRoot = path.join(__appRoot, `./${directory}`);
	const requiredFiles = fs
		.readdirSync(requireRoot)
		.map((file) => { 
			const requiredFile = require(`${requireRoot}/${file}`);
			
			if (!requiredFile.name) {
				requiredFile.name = file.split('.')[0];
			}

			return requiredFile;
		});

	if (asObject) {
		const object = {};
		
		requiredFiles.forEach((requiredFile) => {
			object[requiredFile.name] = requiredFile;
		});

		return object;
	} 

	return requiredFiles;
};

module.exports = requireFiles;