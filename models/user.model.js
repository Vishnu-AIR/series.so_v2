const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        trim: true
    },
    phone: {
        type: String,
        unique: true,
        trim: true,
        required: true
    },
    jid: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    currentReachout: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ReachOut',
        default: null
    },
    type: {
        type: String,
        required: true,
        enum: [
            'new',
            'candidate',
            'freelancer',
            'rof',
            'roc',
            'hr',
            'client',
            'idol'
        ],
        trim: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    metaData:{
        type: Object,
        default: null
    }
});

const User = mongoose.model('User', userSchema);

module.exports = User;
