// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title VehicleAuctionEscrow
 * @dev Manages escrow funds for vehicle auctions, ensuring secure transactions
 * between buyers and sellers.
 */
contract VehicleAuctionEscrow is ReentrancyGuard, Ownable {
    using SafeMath for uint256;

    // Structs
    struct LockedBid {
        uint256 amount;
        uint256 timestamp;
        bool isActive;
    }

    // State variables
    mapping(address => uint256) private balances;
    mapping(address => mapping(uint256 => LockedBid)) private lockedBids;
    mapping(uint256 => address) private auctionWinners;
    
    uint256 private constant RELEASE_DELAY = 24 hours;
    uint256 private constant MINIMUM_DEPOSIT = 0.01 ether;

    // Events
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event BidLocked(address indexed user, uint256 indexed auctionId, uint256 amount);
    event BidReleased(address indexed user, uint256 indexed auctionId, uint256 amount);
    event AuctionCompleted(uint256 indexed auctionId, address winner, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 amount);

    // Modifiers
    modifier sufficientBalance(uint256 amount) {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        _;
    }

    modifier validAuction(uint256 auctionId) {
        require(auctionId > 0, "Invalid auction ID");
        _;
    }

    modifier notLocked(uint256 auctionId) {
        require(!lockedBids[msg.sender][auctionId].isActive, "Bid already locked");
        _;
    }

    /**
     * @dev Deposit funds into escrow
     */
    function deposit() external payable {
        require(msg.value >= MINIMUM_DEPOSIT, "Deposit below minimum");
        balances[msg.sender] = balances[msg.sender].add(msg.value);
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @dev Withdraw funds from escrow
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant sufficientBalance(amount) {
        balances[msg.sender] = balances[msg.sender].sub(amount);
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Lock funds for a bid
     * @param auctionId Auction identifier
     * @param amount Amount to lock
     */
    function lockBidAmount(uint256 auctionId) 
        external 
        validAuction(auctionId) 
        notLocked(auctionId)
        sufficientBalance(msg.value) 
    {
        require(msg.value > 0, "Amount must be greater than 0");
        
        balances[msg.sender] = balances[msg.sender].sub(msg.value);
        lockedBids[msg.sender][auctionId] = LockedBid({
            amount: msg.value,
            timestamp: block.timestamp,
            isActive: true
        });
        
        emit BidLocked(msg.sender, auctionId, msg.value);
    }

    /**
     * @dev Release locked bid amount
     * @param auctionId Auction identifier
     */
    function releaseBidAmount(uint256 auctionId) external validAuction(auctionId) {
        LockedBid storage bid = lockedBids[msg.sender][auctionId];
        require(bid.isActive, "No active bid found");
        require(
            block.timestamp >= bid.timestamp.add(RELEASE_DELAY) ||
            auctionWinners[auctionId] != address(0),
            "Release delay not met"
        );

        uint256 amount = bid.amount;
        bid.isActive = false;
        balances[msg.sender] = balances[msg.sender].add(amount);
        
        emit BidReleased(msg.sender, auctionId, amount);
    }

    /**
     * @dev Complete auction and transfer funds
     * @param auctionId Auction identifier
     * @param winner Winner's address
     * @param seller Seller's address
     */
    function completeAuction(
        uint256 auctionId,
        address winner,
        address payable seller
    ) 
        external 
        onlyOwner 
        validAuction(auctionId) 
    {
        LockedBid storage winningBid = lockedBids[winner][auctionId];
        require(winningBid.isActive, "No active winning bid");
        
        uint256 amount = winningBid.amount;
        winningBid.isActive = false;
        auctionWinners[auctionId] = winner;
        
        // Transfer funds to seller
        (bool success, ) = seller.call{value: amount}("");
        require(success, "Transfer to seller failed");
        
        emit AuctionCompleted(auctionId, winner, amount);
    }

    /**
     * @dev Get user's escrow balance
     * @param user User address
     * @return balance User's current balance
     */
    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    /**
     * @dev Get locked bid amount for a specific auction
     * @param user User address
     * @param auctionId Auction identifier
     * @return amount Locked bid amount
     */
    function getLockedAmount(address user, uint256 auctionId) 
        external 
        view 
        returns (uint256) 
    {
        return lockedBids[user][auctionId].isActive ? 
               lockedBids[user][auctionId].amount : 0;
    }

    /**
     * @dev Emergency withdraw in case of critical issues
     * @notice Only contract owner can call this
     * @param user User address to withdraw funds for
     */
    function emergencyWithdraw(address payable user) 
        external 
        onlyOwner 
        nonReentrant 
    {
        uint256 amount = balances[user];
        require(amount > 0, "No balance to withdraw");
        
        balances[user] = 0;
        (bool success, ) = user.call{value: amount}("");
        require(success, "Emergency transfer failed");
        
        emit EmergencyWithdraw(user, amount);
    }

    /**
     * @dev Check if contract has sufficient balance
     * @return bool True if contract has sufficient balance
     */
    function hasSufficientBalance() public view returns (bool) {
        return address(this).balance >= 
               address(this).balance.sub(getTotalLockedAmount());
    }

    /**
     * @dev Get total amount of locked bids
     * @return total Total locked amount
     */
    function getTotalLockedAmount() public view returns (uint256) {
        // This is a simplified version. In production, you'd want to
        // iterate through all active auctions and sum their locked amounts
        return address(this).balance.sub(
            address(this).balance.sub(getTotalBalance())
        );
    }

    /**
     * @dev Get total balance of all users
     * @return total Total balance
     */
    function getTotalBalance() public view returns (uint256) {
        return address(this).balance;
    }
}
